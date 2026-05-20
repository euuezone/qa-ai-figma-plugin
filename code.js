figma.showUI(__html__, { width: 420, height: 750 });

// 저장 설정 불러오기
Promise.all([
  figma.clientStorage.getAsync('api_key'),
  figma.clientStorage.getAsync('correction_rules')
]).then(([key, rules]) => {
  if (key) figma.ui.postMessage({ type: 'load-key', key });
  if (rules) figma.ui.postMessage({ type: 'load-rules', rules });
});

// 선택 변경 감지 → 미리 캐시 (버튼 클릭 시 선택이 풀리는 문제 방지)
let cachedSelection = [];
figma.on('selectionchange', () => {
  cachedSelection = [...figma.currentPage.selection];
  figma.ui.postMessage({
    type: 'selection-changed',
    count: cachedSelection.length,
    name: cachedSelection.length > 0 ? cachedSelection[0].name : ''
  });
});

// 이미지 형식 자동 감지
function detectMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  return 'image/png';
}

// base64 변환 (btoa 없이)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(bytes) {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    result += B64[b1 >> 2];
    result += B64[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? B64[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < len ? B64[b3 & 63] : '=';
  }
  return result;
}

async function exportNode(node) {
  const errors = [];

  // 방법 1: exportAsync → PNG로 강제 변환 (형식 통일)
  if (typeof node.exportAsync === 'function') {
    try {
      const bytes = await node.exportAsync({ format: 'PNG' });
      return { base64: bytesToBase64(bytes), mime: 'image/png' };
    } catch (e) {
      errors.push('export: ' + e.message);
    }
  } else {
    errors.push('export: 지원 안 함 (타입:' + node.type + ')');
  }

  // 방법 2: 이미지 fill 직접 읽기 (형식 자동 감지)
  if ('fills' in node && Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === 'IMAGE' && fill.imageHash) {
        try {
          const bytes = await figma.getImageByHash(fill.imageHash).getBytesAsync();
          const mime = detectMime(bytes);
          return { base64: bytesToBase64(bytes), mime };
        } catch (e) {
          errors.push('fill: ' + e.message);
        }
      }
    }
  }

  // 방법 3: 부모 노드
  const parent = node.parent;
  if (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
    if (typeof parent.exportAsync === 'function') {
      try {
        const bytes = await parent.exportAsync({ format: 'PNG' });
        return { base64: bytesToBase64(bytes), mime: 'image/png' };
      } catch (e) {
        errors.push('parent: ' + e.message);
      }
    }
  }

  throw new Error(errors.join(' | '));
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'save-key') {
    await figma.clientStorage.setAsync('api_key', msg.key);
  }

  if (msg.type === 'save-rules') {
    await figma.clientStorage.setAsync('correction_rules', msg.rules);
  }

  if (msg.type === 'extract') {
    // 현재 선택 또는 캐시된 선택 사용
    const selection = figma.currentPage.selection.length > 0
      ? [...figma.currentPage.selection]
      : cachedSelection;

    if (selection.length === 0) {
      figma.ui.postMessage({
        type: 'extract-error',
        message: '피그마에서 이미지나 프레임을 먼저 선택해주세요!'
      });
      return;
    }

    const images = [];
    const errors = [];

    for (let i = 0; i < selection.length; i++) {
      const node = selection[i];
      figma.ui.postMessage({
        type: 'extract-progress',
        message: `"${node.name}" 처리 중... (${i + 1}/${selection.length})`
      });
      try {
        const base64 = await exportNode(node);
        images.push({ id: node.id, name: node.name, base64: base64.base64, mime: base64.mime });
      } catch (e) {
        errors.push(`"${node.name}" (${node.type}): ${e.message}`);
      }
    }

    if (images.length === 0) {
      figma.ui.postMessage({
        type: 'extract-error',
        message: `이미지를 가져오지 못했어요.\n\n${errors.join('\n')}`
      });
    } else {
      figma.ui.postMessage({ type: 'extracted', images, errors });
    }
  }

  if (msg.type === 'insert-text') {
    try {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      const textNode = figma.createText();
      textNode.characters = msg.text;
      textNode.fontSize = 14;
      textNode.x = figma.viewport.center.x - 150;
      textNode.y = figma.viewport.center.y;
      figma.currentPage.appendChild(textNode);
      figma.viewport.scrollAndZoomIntoView([textNode]);
      figma.ui.postMessage({ type: 'insert-success' });
    } catch (e) {
      figma.ui.postMessage({ type: 'insert-error', message: e.message });
    }
  }

  if (msg.type === 'insert-correction') {
    try {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      const textNode = figma.createText();
      const fullText = msg.segments.map(s => s.text).join('');
      textNode.characters = fullText;
      textNode.fontSize = 14;
      let pos = 0;
      for (const seg of msg.segments) {
        if (seg.red) {
          textNode.setRangeFills(pos, pos + seg.text.length, [
            { type: 'SOLID', color: { r: 0.9, g: 0.1, b: 0.1 } }
          ]);
        }
        pos += seg.text.length;
      }
      textNode.x = figma.viewport.center.x - 150;
      textNode.y = figma.viewport.center.y;
      figma.currentPage.appendChild(textNode);
      figma.viewport.scrollAndZoomIntoView([textNode]);
      figma.ui.postMessage({ type: 'insert-success' });
    } catch (e) {
      figma.ui.postMessage({ type: 'insert-error', message: e.message });
    }
  }

  if (msg.type === 'paste-review') {
    try {
      const { table, issues } = msg.data;
      if (!table || !table.length) throw new Error('테이블 데이터 없음');

      let fReg  = { family: 'Noto Sans KR', style: 'Regular' };
      let fBold = { family: 'Noto Sans KR', style: 'Bold' };
      try {
        await figma.loadFontAsync(fReg);
        await figma.loadFontAsync(fBold);
      } catch(e) {
        fReg  = { family: 'Inter', style: 'Regular' };
        fBold = { family: 'Inter', style: 'Bold' };
        await figma.loadFontAsync(fReg);
        await figma.loadFontAsync(fBold);
      }

      const imap = new Map();
      (issues || []).forEach(is => {
        if ((is.original || '').trim() !== (is.corrected || '').trim()) {
          imap.set(`${is.row},${is.col}`, is);
        }
      });

      const COL_W  = [110, 110, 78, 220, 200];
      const totalW = COL_W.reduce((a, b) => a + b, 0);
      const PAD    = 7;
      const GAP    = 1;

      const C = {
        border:  { r:.87, g:.87, b:.90 },
        hdrBg:   { r:.93, g:.93, b:.95 },
        hdrText: { r:.40, g:.40, b:.47 },
        text:    { r:.05, g:.05, b:.06 },
        dim:     { r:.60, g:.60, b:.65 },
        alt:     { r:.97, g:.97, b:.98 },
        white:   { r:1,   g:1,   b:1   },
        issBg:   { r:.99, g:.94, b:.94 },
        red:     { r:.83, g:.21, b:.21 },
      };
      const fill = c => [{ type: 'SOLID', color: c }];

      // Step 1: 행 프레임을 먼저 캔버스에 생성해 높이를 측정
      const rowFrames = [];
      for (let ri = 0; ri < table.length; ri++) {
        const row   = table[ri];
        const isHdr = ri === 0;

        const rowF = figma.createFrame();
        rowF.name = isHdr ? '헤더' : `행 ${ri}`;
        rowF.layoutMode = 'HORIZONTAL';
        rowF.primaryAxisSizingMode = 'FIXED';
        rowF.counterAxisSizingMode = 'AUTO';
        rowF.resize(totalW, 36);
        rowF.itemSpacing = GAP;
        rowF.paddingTop = 0; rowF.paddingBottom = 0;
        rowF.paddingLeft = 0; rowF.paddingRight = 0;
        rowF.fills = fill(isHdr ? C.hdrBg : (ri % 2 === 0 ? C.white : C.alt));

        for (let ci = 0; ci < Math.min(row.length, COL_W.length); ci++) {
          const cell  = String(row[ci] || '');
          const issue = imap.get(`${ri},${ci}`);
          const w     = COL_W[ci];

          const cellF = figma.createFrame();
          cellF.name = `${ri}-${ci}`;
          cellF.layoutMode = 'VERTICAL';
          cellF.primaryAxisSizingMode = 'AUTO';
          cellF.counterAxisSizingMode = 'FIXED';
          cellF.resize(w, 36);
          cellF.paddingLeft = PAD; cellF.paddingRight = PAD;
          cellF.paddingTop = 6;   cellF.paddingBottom = 6;
          cellF.itemSpacing = 3;
          cellF.primaryAxisAlignItems = 'CENTER';
          cellF.clipsContent = false;
          cellF.fills = fill(issue ? C.issBg : (isHdr ? C.hdrBg : (ri % 2 === 0 ? C.white : C.alt)));

          if (issue) {
            const t1 = figma.createText();
            t1.fontName = fReg; t1.fontSize = 9;
            t1.characters = issue.original || ' ';
            t1.fills = fill(C.dim);
            t1.textDecoration = 'STRIKETHROUGH';
            cellF.appendChild(t1);
            const t2 = figma.createText();
            t2.fontName = fBold; t2.fontSize = 10;
            t2.characters = issue.corrected || ' ';
            t2.fills = fill(C.red);
            cellF.appendChild(t2);
          } else {
            const t = figma.createText();
            t.fontName = isHdr ? fBold : fReg;
            t.fontSize = isHdr ? 9 : 10;
            t.characters = cell || ' ';
            t.fills = fill(isHdr ? C.hdrText : C.text);
            cellF.appendChild(t);
          }

          rowF.appendChild(cellF);
        }
        rowFrames.push(rowF);
      }

      // Step 2: 총 높이 계산 (각 행의 실제 높이 사용)
      const totalH = rowFrames.reduce((s, r, i) =>
        s + r.height + (i < rowFrames.length - 1 ? GAP : 0), 0);

      // Step 3: 테이블 컨테이너 프레임 (오토레이아웃 없이 절대 좌표)
      const tbl = figma.createFrame();
      tbl.name = 'TC 검토 결과';
      tbl.resize(totalW, totalH);
      tbl.fills        = fill(C.border);
      tbl.strokeWeight = 1;
      tbl.strokes      = fill(C.border);
      tbl.strokeAlign  = 'OUTSIDE';
      tbl.cornerRadius = 4;
      tbl.clipsContent = true;

      // Step 4: 행을 tbl에 이동 후 y 좌표 지정
      let currentY = 0;
      for (const rowF of rowFrames) {
        tbl.appendChild(rowF);
        rowF.x = 0;
        rowF.y = currentY;
        currentY += rowF.height + GAP;
      }

      // Step 5: 뷰포트 중앙에 배치
      const vc = figma.viewport.center;
      tbl.x = Math.round(vc.x - tbl.width / 2);
      tbl.y = Math.round(vc.y - tbl.height / 2);
      figma.currentPage.appendChild(tbl);
      figma.currentPage.selection = [tbl];
      figma.viewport.scrollAndZoomIntoView([tbl]);

      figma.ui.postMessage({ type: 'paste-success' });
    } catch(e) {
      figma.ui.postMessage({ type: 'paste-error', message: e.message });
    }
  }

  if (msg.type === 'extract-text-table') {
    const selection = figma.currentPage.selection.length > 0
      ? [...figma.currentPage.selection]
      : cachedSelection;

    if (selection.length === 0) {
      figma.ui.postMessage({ type: 'text-table-error', message: '피그마에서 노드를 먼저 선택해주세요' });
      return;
    }

    function collectTexts(node) {
      const result = [];
      if (node.type === 'TEXT' && node.absoluteBoundingBox) {
        result.push({
          x: node.absoluteBoundingBox.x,
          y: node.absoluteBoundingBox.y,
          text: node.characters || ''
        });
      }
      if ('children' in node) {
        for (const child of node.children) {
          result.push(...collectTexts(child));
        }
      }
      return result;
    }

    const allTexts = [];
    for (const node of selection) {
      allTexts.push(...collectTexts(node));
    }

    if (allTexts.length === 0) {
      figma.ui.postMessage({ type: 'text-table-error', message: '선택한 노드에서 텍스트를 찾지 못했어요' });
      return;
    }

    // y 좌표 기준 정렬 후 행 그룹화
    allTexts.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
    const ROW_THRESHOLD = 15;
    const rows = [];
    for (const t of allTexts) {
      const lastRow = rows[rows.length - 1];
      if (!lastRow || t.y - lastRow[0].y > ROW_THRESHOLD) {
        rows.push([t]);
      } else {
        lastRow.push(t);
      }
    }

    const table = rows.map(row => {
      row.sort((a, b) => a.x - b.x);
      return row.map(t => t.text);
    });

    figma.ui.postMessage({ type: 'text-table-extracted', table });
  }

  if (msg.type === 'paste-table') {
    try {
      const { table } = msg.data;
      if (!table || !table.length) throw new Error('테이블 데이터 없음');

      let fReg  = { family: 'Noto Sans KR', style: 'Regular' };
      let fBold = { family: 'Noto Sans KR', style: 'Bold' };
      try {
        await figma.loadFontAsync(fReg);
        await figma.loadFontAsync(fBold);
      } catch(e) {
        fReg  = { family: 'Inter', style: 'Regular' };
        fBold = { family: 'Inter', style: 'Bold' };
        await figma.loadFontAsync(fReg);
        await figma.loadFontAsync(fBold);
      }

      const numCols = table[0].length;
      const totalW  = Math.min(numCols * 120, 1600);
      const colW    = Math.floor(totalW / numCols);
      const PAD     = 7;
      const GAP     = 1;

      const C = {
        border:  { r:.87, g:.87, b:.90 },
        hdrBg:   { r:.93, g:.93, b:.95 },
        hdrText: { r:.40, g:.40, b:.47 },
        text:    { r:.05, g:.05, b:.06 },
        alt:     { r:.97, g:.97, b:.98 },
        white:   { r:1,   g:1,   b:1   },
      };
      const fill = c => [{ type: 'SOLID', color: c }];

      const rowFrames = [];
      for (let ri = 0; ri < table.length; ri++) {
        const row   = table[ri];
        const isHdr = ri === 0;

        const rowF = figma.createFrame();
        rowF.name = isHdr ? '헤더' : `행 ${ri}`;
        rowF.layoutMode = 'HORIZONTAL';
        rowF.primaryAxisSizingMode = 'FIXED';
        rowF.counterAxisSizingMode = 'AUTO';
        rowF.resize(totalW, 36);
        rowF.itemSpacing = GAP;
        rowF.paddingTop = 0; rowF.paddingBottom = 0;
        rowF.paddingLeft = 0; rowF.paddingRight = 0;
        rowF.fills = fill(isHdr ? C.hdrBg : (ri % 2 === 0 ? C.white : C.alt));

        for (let ci = 0; ci < Math.min(row.length, numCols); ci++) {
          const cell = String(row[ci] || '');
          const w    = ci === numCols - 1
            ? totalW - colW * (numCols - 1) - GAP * (numCols - 1)
            : colW;

          const cellF = figma.createFrame();
          cellF.name = `${ri}-${ci}`;
          cellF.layoutMode = 'VERTICAL';
          cellF.primaryAxisSizingMode = 'AUTO';
          cellF.counterAxisSizingMode = 'FIXED';
          cellF.resize(w, 36);
          cellF.paddingLeft = PAD; cellF.paddingRight = PAD;
          cellF.paddingTop = 6;   cellF.paddingBottom = 6;
          cellF.itemSpacing = 3;
          cellF.primaryAxisAlignItems = 'CENTER';
          cellF.clipsContent = false;
          cellF.fills = fill(isHdr ? C.hdrBg : (ri % 2 === 0 ? C.white : C.alt));

          const t = figma.createText();
          t.fontName = isHdr ? fBold : fReg;
          t.fontSize = isHdr ? 9 : 10;
          t.characters = cell || ' ';
          t.fills = fill(isHdr ? C.hdrText : C.text);
          cellF.appendChild(t);
          rowF.appendChild(cellF);
        }
        rowFrames.push(rowF);
      }

      const totalH = rowFrames.reduce((s, r, i) =>
        s + r.height + (i < rowFrames.length - 1 ? GAP : 0), 0);

      const tbl = figma.createFrame();
      tbl.name = 'TC 표';
      tbl.resize(totalW, totalH);
      tbl.fills        = fill(C.border);
      tbl.strokeWeight = 1;
      tbl.strokes      = fill(C.border);
      tbl.strokeAlign  = 'OUTSIDE';
      tbl.cornerRadius = 4;
      tbl.clipsContent = true;

      let currentY = 0;
      for (const rowF of rowFrames) {
        tbl.appendChild(rowF);
        rowF.x = 0;
        rowF.y = currentY;
        currentY += rowF.height + GAP;
      }

      const vc = figma.viewport.center;
      tbl.x = Math.round(vc.x - tbl.width / 2);
      tbl.y = Math.round(vc.y - tbl.height / 2);
      figma.currentPage.appendChild(tbl);
      figma.currentPage.selection = [tbl];
      figma.viewport.scrollAndZoomIntoView([tbl]);

      figma.ui.postMessage({ type: 'paste-table-success' });
    } catch(e) {
      figma.ui.postMessage({ type: 'paste-table-error', message: e.message });
    }
  }
};
