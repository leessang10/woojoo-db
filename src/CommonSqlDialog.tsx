import { useState } from 'react';
import { commonSql, engineNames } from './common-sql';
import type { Engine } from './model';
import { useLanguage } from './i18n';
import { ModalSurface } from './components/ModalSurface';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import './common-sql.css';

export function CommonSqlDialog({ engine, onSelect, onClose }: { engine: Engine; onSelect: (sql: string) => void; onClose: () => void }) {
  const { language } = useLanguage();
  const index = language === 'ko' ? 0 : 1;
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [search, setSearch] = useState('');
  const entries = commonSql[engine].filter(entry =>
    [...entry.title, ...entry.description, entry.sql].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <ModalSurface title={tr('자주 쓰는 SQL', 'Common SQL')} onClose={onClose}>
    <section className="modal common-sql-dialog">
      <header><h2>{tr('자주 쓰는 SQL', 'Common SQL')} · {engineNames[engine]}</h2><Button variant="ghost" size="sm" onClick={onClose}>{tr('닫기', 'Close')}</Button></header>
      <p>{tr('선택하면 새 SQL 탭에서 열립니다. 실행 전에 내용을 확인하세요.', 'Select a template to open it in a new SQL tab for review.')}</p>
      {engine === 'sqlite' && <p>{tr('SQLite는 사용자·역할 및 서버 전체의 실행 쿼리·락 조회를 제공하지 않습니다.', 'SQLite does not provide user roles or server-wide query and lock monitoring.')}</p>}
      <Input autoFocus aria-label={tr('SQL 템플릿 검색', 'Search SQL templates')} placeholder={tr('이름, 설명, SQL 검색', 'Search name, description or SQL')} value={search} onChange={event => setSearch(event.target.value)} />
      <div className="common-sql-list">
        {entries.map(entry => <Button key={entry.id} variant="outline" className="common-sql-entry" onClick={() => onSelect(`-- ${entry.title[index]}\n-- ${entry.description[index]}\n${entry.requirement ? `-- ${entry.requirement[index]}\n` : ''}${entry.sql}`)}>
          <strong>{entry.title[index]}</strong>
          <span>{entry.description[index]}</span>
          {entry.requirement && <small>{entry.requirement[index]}</small>}
        </Button>)}
        {!entries.length && <p role="status">{tr('일치하는 SQL이 없습니다.', 'No matching SQL templates.')}</p>}
      </div>
    </section>
  </ModalSurface>;
}
