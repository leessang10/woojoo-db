import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ModalSurface } from "@/components/ModalSurface";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  return <ModalSurface title={t("설정")} onClose={onClose}>
    <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-heading">
        <h2 id="settings-title">{t('설정')}</h2>
        <Button variant="ghost" size="bare" onClick={onClose} aria-label={t('닫기')}><X size={20}/></Button>
      </div>
      <div className="settings-fields">
        <label className="settings-row"><span>{t('테마')}</span>
          <NativeSelect size="sm" aria-label={t('테마')} value={theme} onChange={event => onThemeChange(event.target.value as Theme)}>
            <NativeSelectOption value="dark">{t('다크')}</NativeSelectOption>
            <NativeSelectOption value="light">{t('라이트')}</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="settings-row"><span>{t('언어')}</span>
          <NativeSelect size="sm" aria-label="언어 / Language" value={language} onChange={event => setLanguage(event.target.value as 'ko' | 'en')}>
            <NativeSelectOption value="ko">한국어</NativeSelectOption>
            <NativeSelectOption value="en">English</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="settings-row"><span>{t('사이드바 표시')}</span>
          <Input type="checkbox" checked={sidebarOpen} onChange={event => onSidebarChange(event.target.checked)}/>
        </label>
      </div>
    </section>
  </ModalSurface>;
}
