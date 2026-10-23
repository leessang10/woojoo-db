# AWS 작업 영역 통합 계획

> 상태: 0–4단계와 6단계 구현 완료, 5단계(카탈로그·API Runner) 미구현 · 작성일 2026-10-23 · 기준 커밋 `709ff6a`
>
> 대상: 별도 앱 **Orbit**(`C:\Users\codecrain\projects\aws-gui`)의 기능을 WooJoo 왼쪽 레일의 **AWS 작업 영역**으로 옮긴다. AWS 기능은 사용자 PC에 설치된 AWS CLI v2와 그 프로필을 그대로 사용하며, WooJoo는 자격 증명을 저장하지 않는다.

## 1. 요약

- Orbit은 WooJoo와 같은 스택(React 19 · Tauri 2 · Tailwind 4 · `radix-ui` · `lucide-react` · `@xyflow/react` · `html-to-image`/`jspdf`)이라 **로직은 거의 그대로 재사용**할 수 있다. 다만 화면 셸(자체 `SidebarProvider` 레이아웃, 전역 CSS, `.dark` 클래스 테마, 내부 라우트 상태)은 WooJoo와 맞지 않으므로 **앱을 통째로 끼워 넣지 않고 화면 단위로 옮겨 다시 조립**한다.
- 백엔드는 WooJoo에 이미 있는 `src-tauri/src/aws.rs`(RDS 연결용 조회, 오류 코드 체계)를 **공통 실행기**로 키우고, Orbit의 `main.rs`/`topology.rs`/`workbench.rs` 로직을 `aws_` 접두사 명령으로 옮긴다.
- 1차 목표는 **읽기 전용 조회**(리소스 목록·상세·S3/로그 탐색·인프라 맵)다. Orbit의 쓰기 작업(API Runner 실행, EC2/RDS 시작·중지 등)은 안전 장치 설계를 다시 검토한 뒤 마지막 단계에서 선택적으로 넣는다.
- WooJoo만의 연결 고리: **RDS 상세 → "이 인스턴스로 DB 연결"** 버튼으로 기존 `ConnectionDialog`의 AWS 모드(`AwsConnection.tsx`)를 미리 채워 연다. 두 작업 영역이 따로 노는 것이 아니라 서로 이어진다.

## 2. Orbit 분석

### 2.1 스택과 구조

| 항목 | Orbit | WooJoo | 비고 |
|---|---|---|---|
| 셸 | Tauri 2 | Tauri 2 | 동일 |
| UI | React 19.3, TS 5.9, Vite 7 | React 19, TS 5.7, Vite 6 | Orbit 쪽 신규 문법 사용 여부만 점검 |
| 스타일 | Tailwind 4(CSS-first), shadcn new-york, 전역 `styles.css` | Tailwind 4 + `@layer legacy` 자체 CSS 변수(`--surface`, `--line` …) | **충돌 지점**: 전역 `:root`/`.dark` 토큰, `*`/`body`/`button` 규칙 |
| 테마 | `html.dark` 클래스 | `html[data-theme]` | Orbit 컴포넌트의 `dark:` 변형은 WooJoo 테마 방식으로 바꿔야 함 |
| 상태 | `useState`/`useRef` + 모듈 변수, localStorage(`orbit.*`) | `useState` + 커스텀 훅(`workspace-tabs.ts`), localStorage(`woojoo-*`) | 상태 라이브러리 없음, 그대로 맞음 |
| 라우팅 | 상태 기반 `Route { kind: resources\|catalog\|settings\|api\|detail\|topology }` | 탭 기반(`WorkspaceTab.kind`) | Orbit 라우트 → WooJoo 탭으로 매핑(4장) |
| 다이어그램 | `@xyflow/react` + `elkjs` | `@xyflow/react` + `@dagrejs/dagre` | elkjs 추가 여부 결정 필요(7장) |
| i18n | `i18n.ts` 사전 + 인라인 `text(ko,en)` | `i18n.ts` `t()` + 인라인 `tr(ko,en)` | 거의 같은 패턴, `text`→`tr` 치환 |
| 플러그인 | `tauri-plugin-opener`(AWS 문서 링크만) | 없음 | 문서 링크는 후순위 |
| 코드량 | Rust ~1,400줄(40%가 테스트), TS ~4,900줄, shadcn ~2,500줄 | | |

### 2.2 AWS CLI 호출 방식 (Orbit `src-tauri/src/main.rs`)

- 셸을 거치지 않고 `tokio::process::Command`로 `aws.exe`를 **고정 인자 배열**로 실행한다.
- 실행 파일 탐색: `%ProgramFiles%\Amazon\AWSCLIV2\aws.exe` → PATH의 절대 경로만.
- 환경 변수: `AWS_PAGER=""`, `AWS_CLI_AUTO_PROMPT=off`, `AWS_CLI_OUTPUT_ENCODING=UTF-8`, `AWS_MAX_ATTEMPTS`. stdin null, `kill_on_drop`, Windows `CREATE_NO_WINDOW`.
- 동시 실행 3개 제한(`Semaphore(3)`, 슬롯 대기 5초), 전체 타임아웃 40초, stdout/stderr 각 8 MiB 상한.
- 공통 인자: `--profile --region --output json --no-cli-pager --no-cli-auto-prompt --cli-connect-timeout 10 --cli-read-timeout 20 --max-items 100`, 페이지는 `--starting-token`.
- 입력 검증: 프로필 1–256자·제어 문자 금지, 리전 `[a-z0-9-]{1,64}`, 페이지 토큰 16 KiB 이하.
- 오류: stderr 원문을 2,000자로 잘라 그대로 반환한다. **SSO 만료 전용 처리가 없다**(`ssoHint` 문구는 있지만 미사용). 화면 이동 시 실행 중인 CLI를 취소하지 않는다.

WooJoo의 `aws.rs`는 같은 방식(고정 인자, `kill_on_drop`, `CREATE_NO_WINDOW`)이면서 stderr를 **오류 코드**(`AWS_AUTH_REQUIRED`, `AWS_ACCESS_DENIED` …)로 바꿔 민감한 원문을 화면에 내보내지 않는다. 통합 시 이 오류 코드 방식을 기준으로 삼는다.

### 2.3 Orbit 명령과 사용하는 CLI

| Orbit 명령 | 하는 일 | AWS CLI |
|---|---|---|
| `bootstrap` | CLI 버전·프로필 목록 | `--version`, `configure list-profiles` |
| `account_identity` | 계정 ID | `sts get-caller-identity` |
| `list_resources` | 서비스별 목록(페이지) | `ec2 describe-instances`, `rds describe-db-instances`, `s3api list-buckets`, `logs describe-log-groups` |
| `browse_resources` | S3 접두사 탐색, 로그 이벤트 | `s3api list-objects-v2`(Delimiter `/`), `logs filter-log-events`(최대 31일, 패턴) |
| `topology_query` | 인프라 맵 재료 | `ec2 describe-vpcs/subnets/instances`, `rds describe-db-instances`, `elbv2 describe-load-balancers/target-groups/target-health/load-balancer-attributes`, `s3api list-buckets/get-bucket-location/get-bucket-notification-configuration` |
| `save_diagram` | PNG/PDF 저장 | 없음(`rfd`) |
| `service_catalog`, `service_operations`, `api_input_schema` | 전체 서비스·작업·입력 스키마 | 없음(CLI 설치 폴더의 botocore `service-2.json`을 읽음) |
| `api_skeleton` | 입력 골격 | `<svc> <op> --generate-cli-skeleton input` |
| `set_advanced_enabled`, `prepare_api`, `execute_api` | 임의 API 실행(쓰기는 설정 스위치 + 계정 확인 문구 입력 + 5분 만료 검토 토큰) | `<svc> <op> --no-paginate --cli-input-json …` |

### 2.4 Orbit 화면

1. **리소스 목록**(EC2/RDS/S3/Logs): 로컬 검색(`/`), EC2·RDS 상태 필터, "다음" 페이지, 빠른 상세 시트. 30초 메모리 캐시(최대 12개).
2. **탐색기**: S3 접두사·객체 목록, CloudWatch 로그 이벤트(시간 범위·필터 패턴).
3. **상세**: 개요 / 파일·로그 이벤트 / 작업·편집 / JSON 탭. 작업(시작·중지·재부팅·태그·스냅샷·보존 기간 등)은 모두 API Runner 검토 화면을 거친다.
4. **전체 서비스 카탈로그**: 로컬 서비스 모델을 분류해 보여주고 즐겨찾기(최대 8)·최근(최대 5).
5. **API Runner**: 폼/JSON 편집기, 문서 링크, 검토 후 실행.
6. **인프라 맵**: VPC → 서브넷 → EC2/RDS/ELB/대상 그룹/S3 그래프, PNG/PDF 내보내기(지연 로딩).
7. **설정**: 테마·언어·밀도·기본 리전·고급 작업 스위치·캐시 비우기.
8. 프로필/리전 선택은 사이드바 하단, 계정 ID는 STS로 표시.

브라우저(비 Tauri)에서는 모든 화면이 고정 데이터(fixture)로 동작한다.

## 3. WooJoo 통합 지점 (현재 상태)

- `src/App.tsx`
  - `type WorkArea = 'database'`, `WORK_AREAS` 배열이 레일 버튼을 만든다. `showArea()`는 같은 영역을 다시 누르면 사이드바를 접는다.
  - 사이드바(`<aside className="sidebar" id="database-sidebar">`)는 `area === 'database'`일 때 연결 목록·스키마 트리를 그린다.
  - 상단 바(`.topbar`)의 브레드크럼·연결 상태·"연결 추가"·쿼리 기록 토글은 모두 DB 전용이다.
  - 탭 줄(`.tabs`)과 본문은 `useWorkspaceTabs`(`src/workspace-tabs.ts`)가 관리하며, 탭은 DB 연결(session)에 묶여 있다(`kind: table | query | schema | history`).
  - 우측 `.history-sidebar`(`HistoryPanel`)는 DB 쿼리 기록 전용이다.
- `src/aws.ts`, `src/AwsConnection.tsx`: 연결 대화상자의 "AWS" 모드. 프로필 → `aws_environment`(계정·리전 목록) → `aws_rds_instances`로 RDS를 골라 접속 정보를 채운다.
- `src-tauri/src/aws.rs`: `aws_cli_info`, `aws_environment`, `aws_rds_instances` 세 명령과 실행기(`run`/`json`), 오류 코드 분류(`failure`), 인자 검증(`validate`), 단위 테스트·`#[ignore]` 실환경 테스트.
- `src-tauri/tauri.conf.json` CSP는 `connect-src ipc: http://ipc.localhost`, `img-src 'self' data:`로 Orbit 요구와 맞다. 권한은 `core:event:default`뿐이다.

## 4. 화면 매핑

### 4.1 레일

`WORK_AREAS`에 `{ id: 'aws', icon: Cloud, label: ['AWS', 'AWS'], title: ['AWS · 계정과 리소스', 'AWS · accounts and resources'] }`를 추가하고 `WorkArea = 'database' | 'aws'`로 넓힌다. 마지막으로 연 영역은 `woojoo-work-area`로 저장한다.

### 4.2 사이드바 (`area === 'aws'`)

| 위치 | 내용 | Orbit 출처 |
|---|---|---|
| 상단 | **프로필·리전 선택**(현재 `AwsConnection.tsx`의 프로필/리전 필드를 `AwsContextPicker`로 분리해 대화상자와 공유), 계정 ID, CLI 버전, 다시 확인 | 사이드바 하단 선택기 + `bootstrap`/`account_identity` |
| 본문 | 서비스 트리: **EC2 · RDS · S3 · CloudWatch Logs** 고정 항목 → 클릭 시 목록 탭. 그 아래 **인프라 맵**, **전체 서비스**(카탈로그 단계부터) | 사이드바 탐색 메뉴 |
| 즐겨찾기/최근 | 카탈로그 단계에서 추가(`woojoo-aws-favorites`) | Favorites/Recent |
| 상태 | CLI 없음 / 프로필 없음 / 인증 만료 안내와 `aws sso login --profile …` 복사 버튼 | 신규(Orbit 미구현) |

사이드바 `id`는 영역별로(`database-sidebar` / `aws-sidebar`) 나누고 상단 바 접기 버튼의 `aria-controls`도 영역에 맞춘다.

### 4.3 탭과 본문

AWS 탭은 DB 연결 탭과 **별도의 탭 묶음**으로 관리한다. DB 탭은 연결(session)에 묶여 있고 SQL 편집 상태를 저장하므로 같은 배열에 섞으면 복원·이동 로직이 복잡해진다. 탭 줄 UI(드래그 정렬, 닫기, 가로 스크롤)는 재사용하되 상태는 `src/aws/aws-tabs.ts`(`woojoo-aws-tabs-v1`)에 둔다. 영역을 바꾸면 탭 줄과 본문이 그 영역의 것으로 바뀌고, 다른 영역의 탭 상태는 유지한다.

| AWS 탭 kind | 내용 | Orbit 출처 | 탭 키(중복 방지) |
|---|---|---|---|
| `resources` | 서비스 목록 그리드(검색·상태 필터·다음 페이지·새로고침). 행 선택 → 우측 패널 상세, 더블클릭 → `resource` 탭 | `Resources` | profile·region·service |
| `resource` | 상세: 개요 / 파일(S3) 또는 로그 이벤트(Logs) / JSON. RDS는 "DB 연결" 버튼 | `Details` + `explorer-view.tsx` | profile·region·service·id |
| `topology` | 인프라 맵 + PNG/PDF 내보내기 | `topology*.ts(x)` | profile·region |
| `catalog` | 전체 서비스(5단계) | `Catalog` | 하나 |
| `api` | API Runner(5단계, 읽기 전용부터) | `ApiWorkbench` | service·operation |

목록 그리드는 WooJoo의 `.data-grid` 스타일을 그대로 쓴다(열 정렬·고정 헤더). 상세의 JSON 보기는 기존 CodeMirror(읽기 전용, JSON 언어 추가 시 `@codemirror/lang-json`)를 쓴다.

### 4.4 상단 바

- 브레드크럼: `AWS 프로필 › 리전 › 서비스 › 리소스`. 프로필·리전 조각은 클릭 시 사이드바 선택기로 포커스.
- 오른쪽: 계정 ID, 리전 배지, 프로필 이름에 `prod`가 들어 있으면 기존 `env-banner`(PRODUCTION) 재사용, 새로고침.
- "연결 추가"와 쿼리 기록 토글은 DB 영역에서만 보인다.

### 4.5 우측 패널

`.history-sidebar` 자리를 **영역별 우측 패널**로 일반화한다(`.side-panel`, 영역마다 열림 상태 따로 저장).

| 영역 | 우측 패널 | 토글 |
|---|---|---|
| database | 쿼리 기록(현재 그대로) | `ScrollText`, Ctrl/Cmd+Alt+B |
| aws | **리소스 빠른 상세**(Orbit의 상세 시트 대체: 핵심 속성, 태그, "탭으로 열기", RDS "DB 연결") | `PanelRight`, 같은 단축키 |

나중에 AWS CLI **실행 기록**(어떤 명령을 언제 몇 초 걸려 실행했는지, 인자 중 민감 값 제외)을 우측 패널의 두 번째 탭으로 넣을 수 있다.

### 4.6 데이터베이스 영역과의 연결

- RDS 행/상세의 "DB 연결" → `ConnectionDialog`를 AWS 모드로 열고 프로필·리전·인스턴스를 미리 선택(`AwsConnection`에 `initial` prop 추가).
- 이미 같은 엔드포인트로 저장된 연결이 있으면 "연결 열기"로 바꿔 DB 영역으로 전환.

## 5. 백엔드 명령 설계

### 5.1 모듈 구성

```
src-tauri/src/aws/
  mod.rs        // 명령 re-export
  cli.rs        // 실행기: 탐색·검증·실행·오류 코드 (현재 aws.rs의 run/json/failure/validate + Orbit Runner)
  discovery.rs  // aws_cli_info, aws_environment, aws_rds_instances (기존 명령, 이름 유지)
  resources.rs  // aws_list_resources, aws_browse_resources
  topology.rs   // aws_topology_query, aws_save_diagram
  catalog.rs    // aws_service_catalog, aws_service_operations, aws_api_input_schema (5단계)
  workbench.rs  // aws_prepare_api, aws_execute_api (6단계)
```

기존 `aws.rs`를 `aws/` 폴더로 옮기므로 `main.rs`의 `mod aws;`와 `aws::aws_*` 등록은 그대로 동작한다. Orbit 명령은 모두 **`aws_` 접두사**로 이름을 바꿔(`bootstrap` → `aws_cli_info`로 흡수, `list_resources` → `aws_list_resources` 등) WooJoo 명령과 충돌하지 않게 한다.

### 5.2 공통 실행기 (`cli.rs`)

두 구현의 장점을 합친다.

| 항목 | 채택 |
|---|---|
| 실행 파일 탐색 | WooJoo `cli_path()`(PATH 절대 경로 → ProgramFiles) 유지, macOS/Linux도 동작 |
| 동시성 | Orbit `Semaphore(3)` + 슬롯 대기 5초 → `AWS_BUSY` 코드 |
| 타임아웃·크기 | 40초, stdout 8 MiB 상한 → `AWS_TIMEOUT`, `AWS_RESPONSE_TOO_LARGE` |
| 환경 변수 | 두 앱 합집합(`AWS_PAGER`, `AWS_CLI_AUTO_PROMPT=off`, `AWS_CLI_OUTPUT_ENCODING=UTF-8`, `AWS_MAX_ATTEMPTS`) |
| 공통 인자 | `--profile --region --output json --color off --no-cli-pager --cli-connect-timeout --cli-read-timeout` |
| 오류 | WooJoo 오류 코드 체계 유지(원문 노출 금지). 코드에 없는 실패는 `AWS_CLI_FAILED` + **디버그 빌드에서만** stderr 앞부분 로그 |
| 검증 | WooJoo `validate()`(빈 값·`-` 시작·제어 문자 금지) + Orbit 리전 정규식·토큰 길이 |
| 취소 | 신규: 요청마다 `requestId`를 받아 `aws_cancel(requestId)`로 해당 자식 프로세스 종료(Orbit 미구현 보완). 1단계는 프론트 세대 번호로 늦은 응답만 버리고, 취소 명령은 3단계에서 |

`State`는 `.manage(AwsRunner::new())` 하나만 추가한다(워크벤치 단계에서 `AwsWorkbench` 추가).

### 5.3 명령 목록

| 단계 | 명령 | 입력 | 출력 | CLI |
|---|---|---|---|---|
| 기존 | `aws_cli_info` | – | `{installed, version, profiles}` | `--version`, `configure list-profiles` |
| 기존 | `aws_environment` | profile | `{account, arn, region, regions, regionsWarning}` | `configure get region`, `sts get-caller-identity`, `ec2 describe-regions` |
| 기존 | `aws_rds_instances` | profile, region | 연결용 RDS 요약 | `rds describe-db-instances` |
| 2 | `aws_list_resources` | `{service: 'ec2'\|'rds'\|'s3'\|'logs', profile, region, nextToken?}` | `{rows: Value[], nextToken}` | 2.3 표 |
| 3 | `aws_browse_resources` | `{kind: 's3'\|'logs', profile, region, resource, prefix?, nextToken?, startTime?, endTime?, pattern?}` | `{rows, nextToken}` | `s3api list-objects-v2`, `logs filter-log-events` |
| 4 | `aws_topology_query` | `{profile, region, kind, resource?, nextToken?}` | 원본 JSON | 2.3 표 |
| 4 | `save_erd_export` 재사용 또는 `aws_save_diagram` | 형식, 바이트 | 저장 여부 | 없음 |
| 5 | `aws_service_catalog`, `aws_service_operations`, `aws_api_input_schema`, `aws_api_skeleton` | – | 로컬 모델 | 로컬 파일 / `--generate-cli-skeleton` |
| 6 | `aws_set_advanced_enabled`, `aws_prepare_api`, `aws_execute_api` | 검토 토큰·확인 문구 | 실행 결과 | `<svc> <op> --cli-input-json` |

`service`/`kind`는 문자열 대신 Rust `enum`(`#[serde(rename_all = "lowercase")]`)으로 받아 허용 목록 밖 값은 역직렬화 단계에서 막는다.

### 5.4 Orbit 코드 재사용 정도

| Orbit 파일 | 재사용 | 작업 |
|---|---|---|
| `main.rs` `args_for`/`list_resources`/`browse_resources` | 높음 | 실행기 호출부만 `cli.rs`로 교체, 오류를 코드로 변환 |
| `topology.rs` | 높음 | 명령 이름·실행기 교체 |
| `workbench.rs` | 중간 | 읽기 전용 허용 목록·검토 토큰 로직은 그대로, 쓰기 경로는 6단계 재검토 |
| Rust 테스트(약 40%) | 높음 | 함께 옮기고 `ORBIT_LIVE_PROFILE` → `WOOJOO_TEST_AWS_PROFILE`로 통일 |
| `app-model.ts` `cells()`, `pagination.ts` `mergeRows`, `topology-data/selection/layout.ts`, `api-schema.ts` | 높음 | `src/aws/` 아래로 복사, `Row = Record<string, any>`는 서비스별 최소 타입으로 좁힘 |
| `app.tsx`, `pages.tsx`, `explorer-view.tsx`, `topology.tsx` | 중간~낮음 | 로직(fetch·캐시·세대 번호)은 가져오고 마크업은 WooJoo 클래스와 `components/ui`로 다시 작성 |
| `components/ui/*`(shadcn), `styles.css`, `theme.ts`, `main.tsx` | 사용 안 함 | WooJoo 쪽 컴포넌트·테마 사용. 필요한 컴포넌트(시트·탭 등)는 WooJoo `components/ui`에 같은 방식으로 추가 |

프론트엔드는 Orbit처럼 컴포넌트에서 `invoke()`를 직접 부르지 않고 `src/aws.ts`(→ `src/aws/api.ts`)에 래퍼와 타입을 모은다. 비 Tauri 환경(Playwright)에서는 WooJoo의 `fixtureMode` 방식으로 Orbit fixture를 반환한다.

## 6. 단계별 작업 순서

각 단계는 독립 커밋/PR로, 앞 단계만으로도 앱이 정상 동작해야 한다.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **0. 실행기 정리** | `aws.rs` → `aws/cli.rs` + `aws/discovery.rs`, 세마포어·크기 상한·`AWS_BUSY` 추가. 기존 세 명령 동작 불변 | `cargo test` 통과, 연결 대화상자 AWS 모드 회귀 없음 |
| **1. 영역 셸** | `WORK_AREAS`에 aws 추가, AWS 사이드바(프로필·리전·계정, 서비스 트리), 빈 본문 안내, 상단 바 영역 분기, 우측 패널 영역별 일반화, `AwsContextPicker` 분리 | 레일 전환 시 DB 탭·사이드바 상태 유지, CLI 없음/인증 만료 안내 표시 |
| **2. 리소스 목록** | `aws_list_resources`, AWS 탭 묶음(`aws-tabs.ts`), `resources` 탭(EC2/RDS/S3/Logs 그리드, 검색·필터·페이지·30초 캐시), 우측 빠른 상세 | 네 서비스 목록 조회, fixture 기반 Playwright 테스트 |
| **3. 상세·탐색** | `resource` 탭(개요·JSON), `aws_browse_resources`로 S3 접두사·로그 이벤트, RDS → DB 연결 연동, 실행 취소(`aws_cancel`) | S3 폴더 이동·로그 기간 조회, RDS에서 연결 대화상자 프리필 |
| **4. 인프라 맵** | `aws_topology_query`, `topology` 탭, 내보내기(`save_erd_export` 일반화 검토) | VPC/서브넷/EC2/RDS/ELB/S3 그래프 표시·PNG/PDF 저장 |
| **5. 카탈로그·읽기 전용 API Runner** | 로컬 서비스 모델 읽기, 즐겨찾기·최근, 읽기 전용 작업만 실행 | 허용 목록 밖 작업은 실행 버튼 비활성 |
| **6. (선택) 쓰기 작업** | 고급 작업 스위치(설정 대화상자), 검토 토큰·계정 확인 문구, 리소스 작업(시작·중지 등) | 별도 보안 검토 후 진행 여부 결정 |

예상 규모: 0–2단계가 핵심(프론트 ~1,500줄, Rust ~500줄 이동), 3–4단계가 Orbit 코드 비중이 가장 큰 부분(~2,000줄).

## 7. 위험 요소와 결정할 것

| 위험 | 영향 | 대응 |
|---|---|---|
| **전역 CSS·테마 충돌** | Orbit `styles.css`의 `:root`/`.dark` 토큰과 `*`·`body`·`button` 규칙이 WooJoo 화면을 깨뜨림 | Orbit CSS를 가져오지 않음. 인프라 맵 CSS만 `.aws-topology` 범위로 감싸고 색은 WooJoo 변수(`--surface`, `--line`, `--brand`)로 치환 |
| **SSO 만료** | SSO 프로필은 수시로 만료, Orbit은 원문 오류만 표시 | `AWS_AUTH_REQUIRED` 시 사이드바·본문에 `aws sso login --profile '<p>'` 복사 버튼(이미 `AwsConnection`에 문구 있음). 앱이 직접 로그인 브라우저를 띄우는 기능은 범위 밖 |
| **쓰기 작업 안전성** | 운영 계정에서 실수로 중지·삭제 | 1–5단계는 읽기 전용만. 6단계는 별도 검토, 기본 꺼짐, 계정 ID 포함 확인 문구 |
| **서비스 카탈로그 경로 의존** | `aws.exe` 옆 `awscli/botocore/data`는 Windows 표준 설치(MSI)에서만 확실, macOS(pkg)/Linux/pip 설치는 경로가 다름 | 5단계에서 경로 후보 확장, 못 찾으면 카탈로그 숨기고 4개 기본 서비스만 제공 |
| **대량 목록** | 수천 개 인스턴스·객체에서 느려짐 | `--max-items 100` 페이지 + `mergeRows` 상한(5,000행/8 MiB) 유지, 그리드 가상화는 후속 |
| **프로세스 누수** | 화면 이동 후에도 CLI가 계속 실행 | `kill_on_drop` + 3단계 `aws_cancel` |
| **인프라 맵 레이아웃 엔진** | Orbit은 `elkjs`(약 1.4 MB), WooJoo ERD는 `dagre` | 우선 `elkjs`를 지연 로딩으로 그대로 옮기고, 번들 크기가 문제면 dagre로 바꾸는 것을 4단계에서 측정 후 결정 |
| **App.tsx 비대화** | 이미 850줄, 영역 분기가 늘어남 | AWS 쪽은 `src/aws/AwsWorkspace.tsx`(사이드바·탭·본문·우측 패널을 하나로)로 분리하고 `App.tsx`는 레일·영역 분기만 담당. 전환 시 DB 상태가 사라지지 않도록 DB 작업 영역은 계속 마운트 |
| **문서 링크** | Orbit은 `tauri-plugin-opener`와 전용 capability로 AWS 문서를 엶 | 5단계에서 필요할 때 opener 플러그인 + `https://docs.aws.amazon.com/cli/latest/reference/**` 범위로만 추가 |
| **테스트** | 실제 AWS 계정 없이 검증 어려움 | Rust 파서 단위 테스트 이전, `#[ignore]` 실환경 테스트(`WOOJOO_TEST_AWS_PROFILE`, 읽기 전용), 프론트는 fixture 모드 Playwright |
| **Orbit 앱의 향후** | 두 곳에서 같은 기능 유지보수 | 통합 완료(4단계) 후 Orbit은 보관(archive)하는 것을 권장 |

결정 사항 (2026-10-23):

1. 쓰기 작업 포함. 단, Orbit의 범용 API Runner 대신 **허용 목록 작업만** 넣었다(`src-tauri/src/aws/actions.rs`): EC2 시작·중지·재부팅·종료·이름 변경, RDS 시작·중지·재부팅·스냅샷, S3 버전 관리, 로그 보존 기간 변경·해제·그룹 삭제. 검토(대상 계정·명령 표시) → 리소스 이름 입력 → 실행 직전 계정 재확인 → 재시도 없이 한 번 실행. 검토는 5분 뒤 만료되고 한 번만 쓸 수 있다.
2. 인프라 맵 레이아웃은 `dagre`로 통일(`src/aws/topology-layout.ts`), `elkjs`는 넣지 않았다.
3. 프로필·리전을 바꿔도 열린 AWS 탭은 유지한다. 탭은 연 시점의 프로필·리전에 묶이고, 현재 선택과 다르면 탭에 리전을 함께 표시한다.

## 8. 구현 결과

| 단계 | 상태 | 주요 파일 |
|---|---|---|
| 0. 실행기 정리 | 완료 | `src-tauri/src/aws/cli.rs`(동시 3개·40초·8 MiB·오류 코드·`aws_cancel`), `discovery.rs` |
| 1. 영역 셸 | 완료 | `src/App.tsx`(`WORK_AREAS`·영역별 단축키·DB 화면은 숨김 유지), `src/aws/AwsWorkspace.tsx` |
| 2. 리소스 목록 | 완료 | `src/aws/ResourceList.tsx`, `src-tauri/src/aws/resources.rs` |
| 3. 상세·탐색·RDS 연결 | 완료 | `src/aws/ResourceDetail.tsx`, `AwsConnection.tsx`(`initial` 프리셋) |
| 4. 인프라 맵 | 완료 | `src/aws/TopologyView.tsx`, `topology-data.ts`(Orbit 이식), `src-tauri/src/aws/topology.rs`; 내보내기는 ERD의 `exportDiagram`·`save_erd_export` 재사용 |
| 5. 카탈로그·API Runner | 미구현 | 후속 작업 |
| 6. 쓰기 작업 | 완료(허용 목록) | `src-tauri/src/aws/actions.rs`, `src/aws/ResourceActions.tsx` |

테스트: Rust 단위 테스트(`cargo test aws`), 실환경 읽기 전용 테스트(`WOOJOO_TEST_AWS_PROFILE=<프로필> cargo test aws -- --ignored`), `src/aws/aws-model.test.ts`, `tests/aws-workspace.spec.ts`(목록·상세·S3/로그·쓰기 검토·RDS 연결·인프라 맵·SSO 만료).
