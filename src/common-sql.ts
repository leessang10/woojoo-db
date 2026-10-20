import type { Engine } from './model';

type Text = readonly [ko: string, en: string];
export type CommonSql = { id: string; title: Text; description: Text; sql: string; requirement?: Text };
export const engineNames: Record<Engine, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', sqlite: 'SQLite' };
const monitoring: Text = ['다른 세션 정보는 추가 모니터링 권한이 필요할 수 있습니다.', 'Viewing other sessions may require monitoring privileges.'];
const item = (id: string, title: Text, description: Text, sql: string, requirement?: Text): CommonSql => ({ id, title, description, sql, requirement });

const postgres: CommonSql[] = [
  item('connection', ['현재 연결 정보', 'Connection information'], ['DB, 사용자, 세션 ID와 서버 버전', 'Database, user, session ID and server version'], `SELECT current_database() AS database_name, session_user AS login_user,
       current_user AS effective_user, pg_backend_pid() AS session_id,
       inet_server_addr() AS server_address, inet_server_port() AS server_port,
       version() AS server_version;`),
  item('timezone', ['현재 타임존과 시간', 'Time zone and current time'], ['현재 세션에 적용된 타임존과 UTC 시간', 'Effective session time zone and UTC time'], `SELECT current_setting('TimeZone') AS session_timezone,
       clock_timestamp() AS local_time,
       clock_timestamp() AT TIME ZONE 'UTC' AS utc_time;`),
  item('roles', ['현재 사용자·역할', 'Current user and roles'], ['로그인 계정, 적용 역할과 소속 역할', 'Login, effective role and role memberships'], `SELECT session_user AS login_user, current_user AS effective_user,
       rolname AS member_of
FROM pg_roles
WHERE pg_has_role(current_user, oid, 'MEMBER')
ORDER BY rolname;`),
  item('privileges', ['현재 사용자 권한', 'Current user privileges'], ['현재 DB의 테이블별 실효 권한 (역할·PUBLIC 포함)', 'Effective table privileges in this database, including roles and PUBLIC'], `SELECT n.nspname AS schema_name, c.relname AS table_name,
       has_table_privilege(c.oid, 'SELECT') AS can_select,
       has_table_privilege(c.oid, 'INSERT') AS can_insert,
       has_table_privilege(c.oid, 'UPDATE') AS can_update,
       has_table_privilege(c.oid, 'DELETE') AS can_delete
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname;`),
  item('active', ['현재 실행 중인 쿼리', 'Running queries'], ['현재 DB의 활성 쿼리와 대기 상태', 'Active queries and wait events in this database'], `SELECT pid, usename, application_name, state,
       clock_timestamp() - query_start AS duration,
       wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE datname = current_database() AND state = 'active'
  AND pid <> pg_backend_pid()
ORDER BY query_start;`, monitoring),
  item('long-queries', ['오래 실행 중인 쿼리', 'Long-running queries'], ['30초 이상 실행 중인 쿼리 — 기준 시간을 수정하세요.', 'Queries running for at least 30 seconds; edit the threshold.'], `SELECT pid, usename, clock_timestamp() - query_start AS duration,
       wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE datname = current_database() AND state = 'active'
  AND pid <> pg_backend_pid()
  AND query_start < clock_timestamp() - INTERVAL '30 seconds'
ORDER BY query_start;`, monitoring),
  item('locks', ['락 대기와 차단 세션', 'Lock waits and blockers'], ['대기 쿼리와 이를 막고 있는 세션', 'Waiting queries and their blocking sessions'], `SELECT a.pid AS waiting_pid, a.query AS waiting_query,
       clock_timestamp() - a.query_start AS query_duration,
       b.pid AS blocking_pid, b.usename AS blocking_user,
       b.state AS blocking_state, b.query AS blocking_query
FROM pg_stat_activity a
CROSS JOIN LATERAL unnest(pg_blocking_pids(a.pid)) AS blocker(pid)
LEFT JOIN pg_stat_activity b ON b.pid = blocker.pid
WHERE a.datname = current_database()
ORDER BY a.query_start;`, monitoring),
  item('transactions', ['오래 열린 트랜잭션', 'Long-running transactions'], ['30초 이상 열린 트랜잭션과 유휴 상태', 'Transactions open for at least 30 seconds, including idle sessions'], `SELECT pid, usename, state, clock_timestamp() - xact_start AS duration,
       wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
  AND xact_start < clock_timestamp() - INTERVAL '30 seconds'
ORDER BY xact_start;`, monitoring),
  item('database-size', ['DB 용량', 'Database size'], ['현재 데이터베이스의 전체 크기', 'Total size of the current database'], `SELECT current_database() AS database_name,
       pg_database_size(current_database()) AS size_bytes,
       pg_size_pretty(pg_database_size(current_database())) AS size;`),
  item('table-sizes', ['테이블 용량', 'Table sizes'], ['인덱스를 포함한 테이블 크기 순위', 'Tables ranked by size including indexes'], `SELECT schemaname, relname AS table_name,
       pg_total_relation_size(relid) AS total_bytes,
       pg_size_pretty(pg_table_size(relid)) AS table_size,
       pg_size_pretty(pg_indexes_size(relid)) AS index_size,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY total_bytes DESC;`),
];

function mysqlFamily(engine: 'mysql' | 'mariadb'): CommonSql[] {
  const processTable = engine === 'mysql' ? 'performance_schema.processlist' : 'information_schema.PROCESSLIST';
  const processRequirement: Text = engine === 'mysql'
    ? ['MySQL 8.0.22+ · Performance Schema 조회 권한 · 전체 세션 조회는 PROCESS 권한 필요', 'MySQL 8.0.22+ · Performance Schema access · PROCESS privilege for all sessions']
    : ['전체 세션 조회는 PROCESS 권한이 필요합니다.', 'PROCESS privilege is required to view all sessions.'];
  return [
    item('connection', ['현재 연결 정보', 'Connection information'], ['DB, 접속 계정, 실효 계정과 서버 버전', 'Database, login, effective account and server version'], `SELECT DATABASE() AS database_name, USER() AS login_user,
       CURRENT_USER() AS effective_user, CONNECTION_ID() AS session_id,
       @@hostname AS server_host, @@port AS server_port, VERSION() AS server_version;`),
    item('timezone', ['현재 타임존과 시간', 'Time zone and current time'], ['세션·전역·시스템 타임존과 UTC 시간', 'Session, global and system time zones, plus UTC time'], `SELECT @@session.time_zone AS session_timezone,
       @@global.time_zone AS global_timezone, @@system_time_zone AS system_timezone,
       NOW() AS local_time, UTC_TIMESTAMP() AS utc_time;`),
    item('roles', ['현재 사용자·역할', 'Current user and roles'], ['로그인 계정, 실효 계정과 활성 역할', 'Login, effective account and active roles'], `SELECT USER() AS login_user, CURRENT_USER() AS effective_user,
       CURRENT_ROLE() AS active_roles;`, [engine === 'mysql' ? 'MySQL 8.0+' : 'MariaDB 10.0.5+', engine === 'mysql' ? 'MySQL 8.0+' : 'MariaDB 10.0.5+']),
    item('privileges', ['현재 사용자 권한', 'Current user grants'], ['현재 계정에 부여된 권한·역할 (역할 내부 권한은 별도 확인)', 'Account grants and roles; inspect role grants separately'], 'SHOW GRANTS FOR CURRENT_USER;'),
    item('active', ['현재 실행 중인 쿼리', 'Running queries'], ['현재 DB의 실행 중인 명령과 경과 시간', 'Running commands and elapsed time in this database'], `SELECT ID, USER, HOST, DB, COMMAND, TIME AS elapsed_seconds, STATE, INFO
FROM ${processTable}
WHERE DB = DATABASE() AND ID <> CONNECTION_ID() AND COMMAND <> 'Sleep'
ORDER BY TIME DESC;`, processRequirement),
    item('long-queries', ['오래 실행 중인 쿼리', 'Long-running queries'], ['현재 상태가 30초 이상 지속된 실행 명령', 'Running commands in their current state for at least 30 seconds'], `SELECT ID, USER, HOST, DB, TIME AS state_seconds, STATE, INFO
FROM ${processTable}
WHERE DB = DATABASE() AND ID <> CONNECTION_ID()
  AND COMMAND <> 'Sleep' AND TIME >= 30
ORDER BY TIME DESC;`, processRequirement),
    item('locks', ['락 대기와 차단 세션', 'Lock waits and blockers'], ['서버 전체의 InnoDB 행 락 대기 관계', 'Server-wide InnoDB row lock waits and blocking transactions'], engine === 'mysql' ? `SELECT w.REQUESTING_ENGINE_TRANSACTION_ID AS waiting_transaction,
       r.trx_mysql_thread_id AS waiting_session, r.trx_query AS waiting_query,
       w.BLOCKING_ENGINE_TRANSACTION_ID AS blocking_transaction,
       b.trx_mysql_thread_id AS blocking_session, b.trx_query AS blocking_query
FROM performance_schema.data_lock_waits w
LEFT JOIN information_schema.INNODB_TRX r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
LEFT JOIN information_schema.INNODB_TRX b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID;` : `SELECT w.requesting_trx_id AS waiting_transaction,
       r.trx_mysql_thread_id AS waiting_session, r.trx_query AS waiting_query,
       w.blocking_trx_id AS blocking_transaction,
       b.trx_mysql_thread_id AS blocking_session, b.trx_query AS blocking_query
FROM information_schema.INNODB_LOCK_WAITS w
LEFT JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
LEFT JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_trx_id;`,
    ['PROCESS 권한 필요' + (engine === 'mysql' ? ' · MySQL 8.0+ · Performance Schema 조회 권한' : ''), 'Requires PROCESS' + (engine === 'mysql' ? ' · MySQL 8.0+ · Performance Schema access' : '')]),
    item('transactions', ['오래 열린 트랜잭션', 'Long-running transactions'], ['서버 전체에서 30초 이상 열린 InnoDB 트랜잭션', 'Server-wide InnoDB transactions open for at least 30 seconds'], `SELECT trx_id, trx_mysql_thread_id AS session_id, trx_state, trx_started,
       TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration_seconds,
       trx_rows_locked, trx_rows_modified, trx_query
FROM information_schema.INNODB_TRX
WHERE trx_started < NOW() - INTERVAL 30 SECOND
ORDER BY trx_started;`, ['PROCESS 권한 필요', 'Requires PROCESS privilege']),
    item('database-size', ['DB 용량', 'Database size'], ['현재 DB의 데이터·인덱스 추정 크기', 'Estimated data and index size of the current database'], `SELECT TABLE_SCHEMA AS database_name,
       SUM(COALESCE(DATA_LENGTH, 0)) AS data_bytes,
       SUM(COALESCE(INDEX_LENGTH, 0)) AS index_bytes,
       SUM(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) AS total_bytes
FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
GROUP BY TABLE_SCHEMA;`),
    item('table-sizes', ['테이블 용량', 'Table sizes'], ['데이터·인덱스 추정 크기가 큰 테이블', 'Tables ranked by estimated data and index size'], `SELECT TABLE_NAME, ENGINE, TABLE_ROWS AS estimated_rows,
       DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes,
       COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS total_bytes
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
ORDER BY total_bytes DESC;`),
  ];
}

const sqlite: CommonSql[] = [
  item('connection', ['현재 연결 정보', 'Connection information'], ['연결된 DB 이름과 파일 경로', 'Attached database names and file paths'], 'PRAGMA database_list;'),
  item('version', ['SQLite 버전', 'SQLite version'], ['현재 연결에서 사용하는 SQLite 버전', 'SQLite version used by this connection'], 'SELECT sqlite_version() AS sqlite_version;'),
  item('timezone', ['현재 시간과 UTC 시간', 'Local and UTC time'], ['별도 DB 타임존 설정 없이 호스트의 로컬 시간을 사용합니다.', 'SQLite uses the host local time; it has no database time zone setting.'], `SELECT datetime('now') AS utc_time,
       datetime('now', 'localtime') AS host_local_time;`),
  item('database-size', ['DB 용량', 'Database size'], ['main DB의 페이지 기준 크기와 재사용 가능 공간 (WAL 제외)', 'Main database page size and reusable space, excluding WAL'], `SELECT p.page_count, s.page_size,
       p.page_count * s.page_size AS database_bytes,
       f.freelist_count * s.page_size AS reusable_bytes
FROM pragma_page_count() p, pragma_page_size() s, pragma_freelist_count() f;`, ['SQLite 3.16+', 'SQLite 3.16+']),
  item('table-sizes', ['테이블·인덱스 용량', 'Table and index sizes'], ['main DB의 객체별 페이지 사용량', 'Page usage by object in the main database'], `SELECT name, SUM(pgsize) AS size_bytes, COUNT(*) AS pages
FROM dbstat
GROUP BY name ORDER BY size_bytes DESC;`, ['SQLITE_ENABLE_DBSTAT_VTAB 빌드 옵션 필요', 'Requires the SQLITE_ENABLE_DBSTAT_VTAB build option']),
];

export const commonSql: Record<Engine, CommonSql[]> = { postgres, mysql: mysqlFamily('mysql'), mariadb: mysqlFamily('mariadb'), sqlite };
