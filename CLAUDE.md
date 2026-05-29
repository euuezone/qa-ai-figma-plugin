# QA AI 도우미 — CLAUDE.md

## 프로젝트 개요
피그마 플러그인으로 동작하는 QA 자동화 도구.
TC 작성엔진 규칙을 기반으로 OpenAI API와 연동해 QA를 자동으로 수행.

## 핵심 정보
- **플러그인 ID**: 1634115206701124550
- **로컬 경로**: `~/Desktop/QA-ai/`
- **현재 버전**: `ui.html` (ui_v1~v4 거쳐 완성)
- **GitHub**: euuezone/qa-ai-figma-plugin (push 권한 있음)
- **관제탑 상태**: `~/관제탑/QA-ai/STATUS.md`

## 폴더 구성
```
QA-ai/
  ├── manifest.json              ← 피그마 플러그인 설정 (editorType: figma)
  ├── code.js                    ← 메인 플러그인 로직
  ├── ui.html                    ← 현재 UI (최종본)
  ├── ui_v1~v4.html              ← UI 버전 히스토리 (참고용, 수정 금지)
  ├── index.html                 ← 랜딩/소개 페이지
  ├── rules/                     ← 규칙 데이터 폴더
  ├── rules.js                   ← 규칙 JS
  ├── system_prompts.js          ← AI 시스템 프롬프트
  ├── system_prompt_common.txt   ← 공통 시스템 프롬프트
  └── TC_작성엔진_규칙시트_v0.1.xlsx  ← 규칙 원본 데이터
```

## 기술 구조
- 피그마 플러그인: `code.js`(로직) ↔ `ui.html`(화면) 통신
- OpenAI API: `api.openai.com` 직접 호출
- 규칙 데이터: `rules/` 폴더 + `rules.js`로 관리

## 파일 규칙
- `ui.html`이 최종본 — 수정 시 `ui_v5.html`처럼 버전 올려서 저장
- `ui_v1~v4.html`은 히스토리용으로 보존, 수정 금지

## 주의사항
- 개발 완료 (2026-05-19), GitHub 원격 배포 완료 (초기 배포 커밋 1개)
- OpenAI API 키는 사용자가 직접 입력 (코드에 하드코딩 금지)
- 피그마 플러그인 수정 후 `manifest.json` 버전 정보 확인 권장
