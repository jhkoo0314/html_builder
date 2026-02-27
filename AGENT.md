
```md
# AGENTS.md

이 저장소는 **한글(UTF-8) 안정성**을 최우선으로 한다.  
모든 자동화(Codex/에이전트/스크립트)와 로컬 작업은 본 규칙을 **필수(Mandatory)**로 준수한다.

--

## 1) Encoding Policy (Mandatory)

### 1.1 기본 인코딩 규칙
- 모든 텍스트 파일은 **반드시 UTF-8** 사용.
- 기본 저장은 **UTF-8 (without BOM)**.
- 다음 인코딩은 **절대 금지**:
  - `EUC-KR`, `CP949`, `UTF-16`, `ANSI`, `ISO-8859-*`
- “파일 읽기/쓰기/치환” 작업에서 **인코딩을 명시하지 않는 코드/명령은 금지**한다.

### 1.2 적용 범위(예시)
- 소스: `.js`, `.ts`, `.json`, `.css`, `.html`, `.md`, `.txt`
- 설정: `.env.example`, `.editorconfig`, 각종 config 파일
- 프롬프트/스펙: `spec.md`, `AGENTS.md`, 기타 문서
- 스크립트: `scripts/*.js`, `*.sh`, `*.ps1`(PowerShell 포함)

> 주의: 바이너리 파일(PDF/PNG/JPG/TTF 등)은 텍스트 인코딩 규칙의 대상이 아니다.  
> 바이너리 파일을 텍스트로 읽거나 인코딩 변환하는 작업은 금지.

---

## 2) Required Rules For Agents (Mandatory)

### 2.1 새 파일 생성 규칙
- 새 텍스트 파일 생성 시 반드시 **UTF-8 without BOM**으로 생성한다.
- 샘플/템플릿을 복사할 때도 원본 인코딩을 확인하고 UTF-8을 유지한다.
- 한글이 포함된 파일은 생성 직후 **표시 검증**을 수행한다.

### 2.2 기존 파일 수정 규칙
- 수정 전:
  - 파일이 UTF-8인지 먼저 확인한다.
- 수정 후:
  - 파일 전체가 다른 인코딩으로 변환되며 “전체 라인이 변경”되는 형태의 PR을 만들지 않는다.
- 한글이 `?`, `�`, 깨진 바이트로 보이면:
  - **즉시 중단**하고, 마지막 정상 상태로 되돌린 뒤 재시도한다.

### 2.3 대량 치환/자동 포맷 주의
- 대량 치환(검색/치환, 포맷터, LLM 자동 수정)은 인코딩/라인엔딩을 깨뜨리기 쉽다.
- 아래 현상이 발생하면 즉시 중단:
  - 한글이 `?` 또는 `�`로 변환됨
  - HTML/JSON에 깨진 문자(`�`)가 섞임
  - “파일 전체가 변경된 것처럼” 보이는데 실질 변경은 없음(인코딩/라인엔딩 문제 가능)

---

## 3) File I/O Discipline (Mandatory)

### 3.1 Node.js (fs) — 반드시 utf8 명시
- 텍스트 파일 읽기/쓰기 시 항상 인코딩을 명시한다.

예시:
```js
fs.readFileSync(path, "utf8");
fs.writeFileSync(path, data, "utf8");
```

금지:

```js
fs.readFileSync(path);          // Buffer -> 암묵 처리 금지
fs.writeFileSync(path, data);   // 인코딩 미지정 금지
```

### 3.2 PowerShell — 반드시 UTF-8 명시

* PowerShell에서 파일 생성/치환/저장 시 반드시 UTF-8 인코딩을 명시한다.

예시:

```powershell
Set-Content -Path <path> -Encoding utf8 -Value <content>
Add-Content -Path <path> -Encoding utf8 -Value <content>
```

> 가능하면 BOM 없는 UTF-8 옵션을 우선한다(환경에 따라 동작이 다를 수 있으므로 저장 결과를 확인).

### 3.3 기타 도구

* `sed`, `awk`, `perl`, 포맷터 사용 시 UTF-8을 유지하는 옵션이 있는지 확인한다.
* 인코딩이 불명확한 도구로 파일을 재저장(Rewrite)하는 작업은 금지한다.

---

## 4) Line Endings Policy (Recommended but Strong)

* 기본 라인 엔딩은 **LF**를 권장한다.
* Windows 환경에서 CRLF가 섞이면 diff가 커질 수 있으므로,
  “인코딩 변경 + 라인엔딩 변경”이 동시에 일어나지 않도록 주의한다.
* 라인 엔딩 변경이 목적이 아니라면, 라인 엔딩 전체 변경은 피한다.

---

## 5) HTML/JSON Safety Rules (Mandatory for This Repo)

이 저장소는 LLM 출력(HTML/JSON)을 다루므로, 아래 규칙을 추가로 강제한다.

### 5.1 HTML 생성/후처리 시

* HTML에 `�`(replacement character) 또는 제어문자가 섞이면 실패로 간주하고 즉시 복구/재생성한다.
* `<meta charset="utf-8">`를 반드시 포함한다.
* HTML 조각을 파일로 저장할 때도 `utf8` 인코딩을 반드시 명시한다.

### 5.2 JSON 저장 시

* JSON은 항상 UTF-8로 저장한다.
* JSON에 한글이 포함될 수 있으므로, 이스케이프/직렬화 후 깨짐 여부를 확인한다.

---

## 6) Pre-Commit Checklist (Mandatory)

커밋 전 아래를 확인한다:

1. 한글이 포함된 파일(README, spec, AGENTS, UI 텍스트)이 정상 표시되는가?
2. 의도치 않은 “전체 파일 변경(diff 폭증)”이 없는가?
3. 파일에 `?`, `�` 같은 깨진 문자가 유입되지 않았는가?
4. Node/PowerShell 파일 I/O에서 인코딩이 명시되어 있는가?
5. (LLM 결과물) HTML/JSON에 charset/닫힘 태그/깨진 문자 문제가 없는가?

---

## 7) Stop Rules (Hard Stop)

다음 중 하나라도 발견되면 작업을 즉시 중단하고 원인부터 해결한다:

* 한글이 `?` 또는 `�`로 보임
* 인코딩 변환으로 인해 “의미 없는 전체 파일 변경”이 발생
* 텍스트 파일을 바이너리로 처리하거나, 바이너리 파일을 텍스트로 열어 덮어씀
* 인코딩 미지정 I/O가 코드에 포함됨

---

## 8) Notes for Agents

* 이 저장소는 한글 텍스트(문서/프롬프트/UI)가 핵심 자산이다.
* 기능 구현보다 인코딩 안정성이 우선이며, 인코딩 손상은 결함으로 취급한다.
