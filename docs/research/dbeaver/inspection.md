# DBeaver 설치본 분석과 경량 DB 클라이언트 방향

분석일: 2026-10-20 (Asia/Seoul)

대상: `%LOCALAPPDATA%\DBeaver`

공개 저장소에는 분석 요약과 자체 앱 화면만 포함한다. 아래 증거 목록의 원본 JSON 및 추출한 타사 manifest/plugin.xml은 로컬 조사 자료로 보관하며 Git에서 제외한다.

사용자가 확정한 목적은 가볍고 현대적인 DB 네비게이터이며, 우선 지원 대상은 PostgreSQL + MySQL/MariaDB다. 아래 구현 방향은 제안이며 승인된 제품 설계가 아니다.

## 조사 범위와 결과

| 질문 | 상태 | 근거 |
|---|---|---|
| 설치된 제품과 런타임은 무엇인가? | 확인 | `.eclipseproduct`, `jre/release`, `dbeaver.ini` |
| 용량은 어디에 쓰이는가? | 확인 | 설치 디렉터리 파일 크기 집계 |
| 주요 기능의 패키지 경계는 무엇인가? | 부분 확인 | REA JAR 인벤토리 3건, 주요 번들 7개의 manifest와 plugin.xml |
| PostgreSQL/MySQL/MariaDB 연결 방식은? | 선언 확인 | DB별 plugin.xml의 provider 및 JDBC 드라이버 선언 |
| 실제 시작 지연과 메모리 병목은 무엇인가? | 미확인 | 실행 중 DBeaver 프로세스가 없었으며 실행/프로파일링하지 않음 |
| 구체적인 화면 사용성과 SQL 처리 동작은? | 미확인 | UI 관찰, 바이트코드 디컴파일, DB 연결 테스트 미수행 |

REA 6.7.0 CLI `inspect-artifact`를 사용했다. 이 대화에는 직접 호출할 REA MCP 도구가 노출되지 않았다. CLI 결과는 설치본의 ZIP/JAR 멤버 구성 및 해시를 검증한 것이며 Java 메서드 실행 흐름을 복원한 것은 아니다. 일반 PowerShell/.NET ZIP/XML 분석은 REA 증거와 구분한다.

## 관찰된 사실

- DBeaver 26.2.0, snapshot `26.2.0-202608301738`, 배포 메타데이터의 commit `79b6875`.
- 내장 Java 런타임 버전은 `25.0.3`. 주요 번들은 Java 21 실행 환경을 요구하며 JDK 25 빌드를 선언한다.
- 설치 디렉터리: 914개 파일, 211,502,456 bytes ≈ 201.70 MiB.
- `jre`: 104,933,178 bytes ≈ 100.07 MiB.
- `plugins`: 102,462,811 bytes ≈ 97.72 MiB.
- 플러그인 폴더 최상위 항목 373개 중 JAR는 367개다. 이 숫자는 실행 중 로드된 모듈 수가 아니다.
- `dbeaver.ini`는 `-Xms64m`, `-Xmx1024m`을 지정한다. 최대 Java heap 설정은 실제 메모리 사용량이나 전체 프로세스 메모리 상한과 같지 않다.
- 주요 번들의 `Require-Bundle`에는 Eclipse e4, SWT, workbench, registry, JDBC 및 편집기 모듈 의존성이 선언되어 있다.
- 조사한 주요 번들은 `Bundle-ActivationPolicy: lazy`를 선언한다. 플러그인 개수만으로 시작 시 모든 모듈이 로드된다고 판단할 수 없다.
- PostgreSQL은 `PostgreDataSourceProvider`, MySQL은 `MySQLDataSourceProvider`를 등록한다. MySQL 확장에 MariaDB JDBC 드라이버도 별도로 선언된다.
- JDBC URL과 기본 포트는 PostgreSQL `5432`, MySQL/MariaDB `3306`으로 선언되어 있다.

집계는 이 설치 디렉터리만 포함한다. 별도 사용자 프로필, 다운로드한 드라이버 캐시, 데이터베이스 데이터 및 디스크 실제 할당량을 포함하지 않는다.

## 기능 경계

| 영역 | 조사한 번들 | 확인한 선언/구성 |
|---|---|---|
| DB 탐색 | `org.jkiss.dbeaver.ui.navigator` | Eclipse view, command, handler, 메뉴, 키바인딩 등록; 376개 class 파일 |
| SQL 편집 | `org.jkiss.dbeaver.ui.editors.sql` | SQL 모델, 결과 편집기, navigator, Eclipse text editor 의존; 553개 class 파일 |
| 데이터 결과 | `org.jkiss.dbeaver.ui.editors.data` | resultset presentation/panel, data manager 확장; 683개 class 파일 |
| DB 공통 연결 | `org.jkiss.dbeaver.model.jdbc` | JDBC session/data source 관련 클래스; 118개 class 파일 |
| PostgreSQL | `org.jkiss.dbeaver.ext.postgresql` | provider, SQL dialect, object manager, 인증, task 확장; 343개 class 파일 |
| MySQL/MariaDB | `org.jkiss.dbeaver.ext.mysql` | provider, SQL dialect, 데이터 타입, task 확장; 145개 class 파일 |
| 앱 셸 | `org.jkiss.dbeaver.ui.app.standalone` | Eclipse application/product, workbench, 설정, 메뉴 등록; 84개 class 파일 |

클래스 수는 내부/익명 클래스를 포함하며 기능 수나 복잡도 점수로 해석하지 않는다. 클래스 이름과 확장점은 정적 구성 증거이며 실제 호출 관계를 입증하지 않는다.

## 해석

설치 용량의 대부분이 JVM과 플러그인에 분포한다. 기능 범위를 좁히고 별도 JVM을 배포하지 않는 설계는 설치 용량을 줄일 가능성이 있다.

그러나 “Java이므로 느리다”는 결론은 이번 조사로 입증되지 않는다. 시작 시 플러그인 활성화, 저장된 작업 공간 복원, 메타데이터 조회, 연결 지연, 결과 렌더링 각각을 측정해야 한다. 디자인에 대한 사용자 불만과 UI 기술 선택 역시 별개의 문제다.

## 재구현 방향 제안

우선 후보는 **Tauri 2 + Rust DB 서비스 + TypeScript UI**다. UI 프레임워크는 React 등을 검토하되 아직 확정하지 않았다. Tauri는 시스템 WebView를 사용하고 Windows에서는 WebView2를 사용한다. Rust core와 UI 간 IPC로 DB 작업과 화면 렌더링을 분리할 수 있다.

공식 근거:

- https://v2.tauri.app/start/
- https://v2.tauri.app/concept/process-model/
- https://v2.tauri.app/concept/inter-process-communication/

이는 성능 보장이 아니다. WebView 프로세스를 포함한 총 메모리와 대용량 결과 전달 비용을 측정해야 한다. JVM을 제거하면 JDBC의 폭넓은 드라이버 생태계도 자동으로 따라오지 않으므로, PostgreSQL과 MySQL/MariaDB 어댑터를 명시적으로 구현해야 한다.

비교 후보는 Windows에 집중하는 .NET 네이티브 UI 또는 기존 JDBC를 별도 프로세스로 유지하는 구조다. 전자는 플랫폼 범위 선택이 필요하고, 후자는 DB 호환성 유지에 유리하지만 JVM 배포 부담이 남는다. 가벼운 배포와 현대적 UI가 목표이고 지원 DB가 제한되어 있어 Tauri 후보를 먼저 검토한다.

첫 제품 범위 후보:

1. 연결 프로필, 연결 테스트, SSL 설정과 OS 자격 증명 저장.
2. DB/스키마/테이블 탐색과 노드 확장 시 필요한 메타데이터만 조회.
3. SQL 탭, 선택 구문 실행, 실행 취소, 실행 시간 및 오류 표시.
4. 결과 행의 제한된 배치 전송, 가상 스크롤, 필터/정렬 및 CSV 내보내기.
5. 키로 식별 가능한 행의 수정 사항 미리보기, 적용/취소, 트랜잭션 상태 표시.
6. 최근 쿼리와 탭 복원. 연결 복원은 화면 표시를 막지 않도록 분리.

설계에서 놓치지 말아야 할 부분:

- 취소 버튼은 DB 서버의 실제 취소 기능과 연결하고, 실행별 연결 소유권을 관리한다.
- 트랜잭션 중인 탭은 동일 DB 세션에 고정한다.
- PostgreSQL과 MySQL/MariaDB의 SQL 방언 및 metadata 차이를 공통 인터페이스 뒤에 보존한다.
- bigint/decimal을 JavaScript number로 강제 변환하지 않는다. NULL, 날짜/시간, binary, JSON도 타입 정보를 유지한다.
- 전체 결과를 메모리에 모으지 않는다. 행 배치 크기와 UI 소비 속도를 제어한다.
- DB 측 필터/정렬과 현재 가져온 행에 대한 로컬 정렬을 혼동시키지 않는다.
- SQL 편집기의 구문 강조 지원을 정확한 SQL 파싱/검증 능력으로 간주하지 않는다.

위 목록의 우선순위와 SSH 터널, DDL 편집, ERD, import/export 범위는 아직 사용자 요구 확인이 필요하다.

## 성능 검증 계획

같은 PC, 같은 DB, 같은 데이터로 기존 앱과 후보 앱을 비교한다.

- 콜드/웜 시작을 분리해 첫 창 표시와 편집 가능 시점을 반복 측정.
- 초기 상태와 연결 후 전체 앱 프로세스 트리의 working set/private memory 기록.
- 1,000개 테이블 탐색에서 첫 목록 표시, 노드 확장 및 재방문 시간 측정.
- 10만 행 결과에서 첫 배치 시간, 스크롤 반응, 최대 메모리 측정.
- 장시간 쿼리 취소, 트랜잭션 유지, 연결 끊김/복구 테스트.

현재는 측정 결과나 목표 달성 보장이 없다.

## 증거 목록

| 파일 | REA Evidence ID | 범위 |
|---|---|---|
| `rea-navigator.json` | `ev_cc521db08e13e0caf6cc023e2d5562a75d02960c65aefde82b0927e79632744c` | navigator JAR 정적 ZIP inventory |
| `rea-sql.json` | `ev_17e6e8241c5fcf76a687bee11cf5aabf17dbfea79498ca8b838dd894557872ec` | SQL editor JAR 정적 ZIP inventory |
| `rea-data.json` | `ev_ae6f3158d63a37ec1879bbd6c9e267b34dfb67bc6819627f1b4012bfaec4f8ef` | data editor JAR 정적 ZIP inventory |
| `installation-inventory.json` | 해당 없음: PowerShell/.NET 조사 | 크기 집계, 번들 해시, manifest, XML 확장점 |

REA 결과는 각 JAR의 central-directory entry 범위에서 complete다. ZIP의 entry 외부 바이트를 모두 포함하거나 앱 전체 동작을 조사했다는 의미가 아니다. 선택한 번들의 manifest와 plugin.xml 원문도 이 디렉터리에 보관했다. 앱 실행, DB 접속, 저장된 연결 비밀번호 열람, 설치본 변경은 수행하지 않았다.
