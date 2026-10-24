# UI/UX 개선 및 검증 — 2026-10-25

personal-ui-ux 기준. 기존 Redis 실시간 흐름 작업을 유지하고 앞선 검토의 14개 항목을 반영했다.

| 항목 | 반영 내용 |
|---|---|
| Docker 영구 삭제 | 공통 확인창에 잠금 해제, 이름 일치 확인, 재잠금, 취소 보호 추가 |
| Docker 삭제 가능 상태 | 상세·메뉴·실행 직전 공통 규칙 적용. 실행 중 컨테이너, 기본 네트워크, 참조 중 리소스 차단 |
| API 저장 오류 | 자동 소멸하지 않는 닫기 가능한 오류 표시 |
| API 탭 보기 | 요청별 패널 유지로 설정 섹션·응답 보기·스크롤 유지 |
| API 재요청 실패 | 이전 성공 응답과 조회 시각 보존, 이전 응답 표시와 새 오류 분리 |
| Redis 페이지 | 추가 조회 시 페이지 유지, 검색 범위 변경 시 초기화 |
| Redis 값 형식 | JSON 불가 값은 TEXT/HEX의 실제 표시와 선택 상태 일치 |
| DB 삭제 버튼 | 붉은 삭제 버튼과 대상별 실행 문구 |
| API 항목 메뉴 | 요청·컬렉션에 일반 클릭 가능한 더보기 제공 |
| AWS 맵 선택 | 재조회 중 선택 유지, 완료 시 동일 ID 갱신, 정상 조회에서 사라진 대상 해제 |
| Docker 관계도 | 간격 확대, 긴 연결 라벨 축약과 전체 툴팁, 최소 창 크기의 초기 맞춤 개선 |
| API·AWS 탭 | 공통 이름 변경, 드래그 재배치, 메뉴를 통한 좌우 이동 |
| Redis JSON | 100개 이후 항목을 트리 안에서 추가 표시 |
| API 크기 조절·복사 | 방향키/Home/End 분할 조절, 복사 성공·실패 알림 |

## 검증

- TypeScript 검사 및 프로덕션 빌드 통과. 기존 번들 크기 경고는 남아 있다.
- 단위 테스트 20개 파일 / 123개 통과.
- 관련 UI 회귀 테스트 78개 통과: 첫 실행 68개 통과 후, 선택자를 보완한 5개 및 추가 5개 모두 통과.
- 삭제 검증은 모킹된 IPC에만 실행했으며 실제 리소스는 삭제하지 않았다.
- 960×640에서 한국어/영어 × 라이트/다크 네 조합 캡처. DB 삭제, Docker 삭제, API 탭 메뉴와 입력창, Select, Redis 상세, AWS 목록·맵 확인.
- 실제 데스크톱 네이티브 연결은 검증하지 않았다. 브라우저 렌더링과 모킹된 데스크톱 계약을 검증했다.

## 캡처

- 기본 네 조합: test-results/review-final/ui-review-fixes-review-matrix-{ko,en}-{light,dark}/
- Docker 삭제: test-results/review-final/docker-workspace-deletion-layout-{ko,en}-{light,dark}/delete.png
- DB 삭제: test-results/review-additional/ui-review-fixes-DB-deletion-layout-{ko,en}-{light,dark}/db-delete.png
- AWS: test-results/review-additional/aws-workspace-AWS-minimum-layout-{ko,en}-{light,dark}/

## 테스트 파일

- tests/ui-review-fixes.spec.ts
- tests/api-workspace.spec.ts
- tests/aws-workspace.spec.ts
- tests/docker-workspace.spec.ts
- tests/structure.spec.ts
- tests/confirmations.spec.ts
- tests/redis-native-contract.spec.ts
