# Third-party licenses / 타사 라이선스

Woojoo 자체 소스에는 [MIT](LICENSE)가 적용됩니다. 타사 구성 요소의 저작권과 라이선스는 그대로 유지됩니다. 아래는 주요 직접 의존성과 번들 리소스의 안내이며, 전체 전이 의존성 SBOM은 아닙니다. 정확한 버전은 package-lock.json과 src-tauri/Cargo.lock에 기록됩니다.

Woojoo uses the [MIT License](LICENSE). Third-party components retain their copyright and license terms. This index covers direct frontend dependencies, selected backend components, and bundled resources; it is not a complete transitive dependency SBOM. See the lockfiles for resolved versions.

## Bundled resources / 번들 리소스

| Component | License | Notice |
| --- | --- | --- |
| [Pretendard Variable 1.3.9](https://github.com/orioncactus/pretendard) — Copyright (c) 2021 Kil Hyung-jin; Reserved Font Name Pretendard | SIL OFL 1.1 | [Full license](public/fonts/pretendard/LICENSE.txt) |
| [shadcn/ui](https://github.com/shadcn-ui/ui) — Copyright (c) 2023 shadcn | MIT | [Full license](docs/licenses/shadcn-ui.txt) |

Pretendard is bundled as a local WOFF2 font; Woojoo’s MIT license does not replace the font license. Pretendard는 로컬 WOFF2로 포함하며 앱의 MIT 라이선스와 별도로 OFL 고지를 보존합니다.

## Frontend dependencies / 프런트엔드

| Component | Version | License | Text |
| --- | --- | --- | --- |
| @codemirror/lang-json | 6.0.2 | MIT | [Full text](docs/licenses/codemirror-lang-json.txt) |
| @codemirror/lang-sql | 6.10.0 | MIT | [Full text](docs/licenses/frontend.txt) |
| @codemirror/theme-one-dark | 6.1.3 | MIT | [Full text](docs/licenses/frontend.txt) |
| @dagrejs/dagre | 3.1.1 | MIT | [Full text](docs/licenses/frontend.txt) |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | [Full text](docs/licenses/frontend.txt) |
| @uiw/react-codemirror | 4.25.12 | MIT | [Full text](docs/licenses/react-codemirror.txt) |
| @xyflow/react | 12.12.0 | MIT | [Full text](docs/licenses/frontend.txt) |
| class-variance-authority | 0.7.1 | Apache-2.0 | [Full text](docs/licenses/frontend.txt) |
| clsx | 2.1.1 | MIT | [Full text](docs/licenses/frontend.txt) |
| html-to-image | 1.11.11 | MIT | [Full text](docs/licenses/frontend.txt) |
| jspdf | 4.2.1 | MIT | [Full text](docs/licenses/frontend.txt) |
| lucide-react | 0.468.0 | ISC | [Full text](docs/licenses/frontend.txt) |
| radix-ui | 1.8.1 | MIT | [Full text](docs/licenses/frontend.txt) |
| react | 19.3.1 | MIT | [Full text](docs/licenses/frontend.txt) |
| react-day-picker | 10.0.2 | MIT | [Full text](docs/licenses/calendar.txt) |
| date-fns | 4.4.0 | MIT | [Full text](docs/licenses/calendar.txt) |
| @date-fns/tz | 1.5.0 | MIT | [Full text](docs/licenses/calendar.txt) |
| react-dom | 19.3.1 | MIT | [Full text](docs/licenses/frontend.txt) |
| tailwind-merge | 3.7.0 | MIT | [Full text](docs/licenses/frontend.txt) |

The @uiw/react-codemirror npm package does not include its license file; the notice is copied from its [upstream repository](https://github.com/uiwjs/react-codemirror/blob/master/LICENSE). See also the [ERD notices](docs/ERD-THIRD-PARTY-NOTICES.txt) for associated dependencies.

## Backend components / 백엔드

| Component | Version | License |
| --- | --- | --- |
| tauri | 2.12.4 | MIT OR Apache-2.0 |
| sqlx | 0.8.6 | MIT OR Apache-2.0 |
| tokio | 1.54.0 | MIT |
| rfd | 0.17.2 | MIT |

[Backend license texts](docs/licenses/backend.txt). Other Rust dependencies and their versions are listed in [Cargo.lock](src-tauri/Cargo.lock). WebView2, AWS CLI, and database backup/restore tools are separately installed products, not covered by Woojoo’s MIT license.
