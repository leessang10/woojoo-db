# UI/UX 개선 검증 — 2026-10-21

## 적용 사항

- 실패한 작업과 이전 성공 결과를 구분한다. 오류 메시지를 닫아도 이전 결과 표시는 유지하며, 새 조회가 성공하면 해제한다.
- 데이터 도구에서는 SQL 편집기를 기본으로 접고 펼치기 및 높이 조절을 제공한다. 필터 입력 너비를 유연하게 조절한다.
- 연결 대화상자는 본문만 스크롤하며 하단 작업 버튼은 고정한다.
- SQL 도구 버튼 높이와 글자 크기를 늘리고 기존 그룹 구분을 유지한다.
- SQL 기록과 실행한 쿼리의 목적을 안내하며, 처리 시간은 DB 처리와 전체 소요를 구분한다.
- 브라우저 환경에서 사용할 수 없는 연결 동작을 비활성화한다.
- 최초 연결 안내와 ERD의 기기 내 초안 저장 / DB 변경 검토 문구를 명확히 한다.

## 자동 검증

- 프런트엔드 빌드 성공.
- Windows 네이티브 빌드 성공: `cargo build --manifest-path src-tauri/Cargo.toml --features custom-protocol`.
- 단위 테스트 33개 통과.
- Playwright UI 테스트 38개 통과: SQL 도구, 확인 대화상자, 비밀번호 저장, ERD 변경, 데이터 도구, 워크스페이스, 탭, AWS 연결 화면, 로컬 DB, 이번 UX 회귀 테스트.
- 960×640 연결 대화상자의 하단 버튼 노출, 1280×720 데이터 도구의 필터 배치와 결과 영역을 자동 검증했다.
- `git diff --check` 통과.

## 실제 Windows 앱 검증

`releases/Woojoo-ux-preview.exe`를 별도 WebView 프로필로 실행했다. 이 파일은 UI가 내장된 디버그 검증 빌드다.

임시 SQLite 파일에 30행의 테스트 데이터를 준비하고 실제 앱에서 연결했다. RDS 연결은 이번 검증에 포함하지 않았다.

1. 데이터 도구에서 SQL 편집기가 접히고 필터가 한 줄로 표시되는 것을 확인했다: [화면](native-data-tools.png).
2. `SELECT * FROM audit_rows LIMIT 2;`가 실제로 2행을 반환했다.
3. 존재하지 않는 테스트 테이블 조회 시 작업 실패와 이전 성공 결과가 함께 표시됐다: [화면](native-query-failure.png).
4. 오류 메시지를 닫아도 이전 결과 안내가 유지됐다: [화면](native-error-dismissed.png).
5. `SELECT * FROM audit_rows LIMIT 3;` 재실행으로 3행을 반환하고 실패 상태가 해제됐다: [화면](native-query-recovered.png).

작은 창의 경계 조건은 위 Playwright 테스트로 확인했으며, 실제 Windows 창은 기본 크기에서 검증했다.
