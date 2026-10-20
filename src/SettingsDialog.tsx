import { X } from 'lucide-react';
import { useLanguage } from './i18n';
import type { Theme } from './theme';

type Props = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  sidebarOpen: boolean;
  onSidebarChange: (open: boolean) => void;
  onClose: () => void;
};

export function SettingsDialog({ theme, onThemeChange, sidebarOpen, onSidebarChange, onClose }: Props) {
  const { language, setLanguage, t } = useLanguage();
  return <div className="modal-backdrop">
    <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-heading">
        <h2 id="settings-title">{t('설정')}</h2>
        <button onClick={onClose} aria-label={t('닫기')}><X size={20}/></button>
      </div>
      <div className="settings-fields">
        <label className="settings-row"><span>{t('테마')}</span>
          <select aria-label={t('테마')} value={theme} onChange={event => onThemeChange(event.target.value as Theme)}>
            <option value="dark">{t('다크')}</option>
            <option value="light">{t('라이트')}</option>
          </select>
        </label>
        <label className="settings-row"><span>{t('언어')}</span>
          <select aria-label={t('언어')} value={language} onChange={event => setLanguage(event.target.value as 'ko' | 'en')}>
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="settings-row"><span>{t('사이드바 표시')}</span>
          <input type="checkbox" checked={sidebarOpen} onChange={event => onSidebarChange(event.target.checked)}/>
        </label>
      </div>
    </section>
  </div>;
}
