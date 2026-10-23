import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ModalSurface } from "@/components/ModalSurface";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from 'lucide-react';
import { useLanguage } from './i18n';
import type { ThemePreference } from './theme';
import { DEFAULT_SETTINGS, EDITOR_FONT_SIZES, RESULT_LIMITS, updateSettings, useSettings } from './settings';

type Props = {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  sidebarOpen: boolean;
  onSidebarChange: (open: boolean) => void;
  onClose: () => void;
};

export function SettingsDialog({ theme, onThemeChange, sidebarOpen, onSidebarChange, onClose }: Props) {
  const { language, setLanguage, t } = useLanguage();
  const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  const settings = useSettings();
  return <ModalSurface title={t("설정")} onClose={onClose}>
    <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-heading">
        <h2 id="settings-title">{t('설정')}</h2>
        <Button variant="ghost" size="bare" onClick={onClose} aria-label={t('닫기')}><X size={20}/></Button>
      </div>
      <div className="settings-fields">
        <h3 className="settings-section">{tr('일반', 'General')}</h3>
        <label className="settings-row"><span>{t('테마')}</span>
          <NativeSelect size="sm" aria-label={t('테마')} value={theme} onChange={event => onThemeChange(event.target.value as ThemePreference)}>
            <NativeSelectOption value="system">{tr('시스템 설정 따르기', 'Follow system')}</NativeSelectOption>
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

        <h3 className="settings-section">{tr('데이터베이스', 'Databases')}</h3>
        <label className="settings-row"><span>{tr('결과 최대 행 수', 'Maximum result rows')}<small>{tr('테이블 보기와 쿼리 결과에서 불러올 행 수 · 다음 조회부터 적용', 'Rows loaded for table views and query results · applies to the next run')}</small></span>
          <NativeSelect size="sm" aria-label={tr('결과 최대 행 수', 'Maximum result rows')} value={String(settings.resultLimit)} onChange={event => updateSettings({ resultLimit: Number(event.target.value) })}>
            {RESULT_LIMITS.map(limit => <NativeSelectOption key={limit} value={String(limit)}>{limit.toLocaleString()}{tr('행', ' rows')}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label className="settings-row"><span>{tr('편집기 글꼴 크기', 'Editor font size')}<small>{tr('SQL 편집기와 정의 보기', 'SQL editor and definition views')}</small></span>
          <NativeSelect size="sm" aria-label={tr('편집기 글꼴 크기', 'Editor font size')} value={String(settings.editorFontSize)} onChange={event => updateSettings({ editorFontSize: Number(event.target.value) })}>
            {EDITOR_FONT_SIZES.map(size => <NativeSelectOption key={size} value={String(size)}>{size}px</NativeSelectOption>)}
          </NativeSelect>
        </label>

        <h3 className="settings-section">AWS</h3>
        <label className="settings-row"><span>{tr('변경 작업 허용', 'Allow changes')}<small>{tr('시작·중지·삭제 같은 작업을 상세 탭에서 검토 후 실행', 'Review and run actions such as start, stop or delete from detail tabs')}</small></span>
          <Input type="checkbox" aria-label={tr('AWS 변경 작업 허용', 'Allow AWS changes')} checked={settings.awsActions} onChange={event => updateSettings({ awsActions: event.target.checked })}/>
        </label>
        <label className="settings-row settings-row-stacked"><span>{tr('운영 프로필로 볼 단어', 'Production profile words')}<small>{tr('프로필 이름에 이 단어가 들어가면 PRODUCTION 경고를 표시합니다 · 쉼표로 구분', 'Profiles whose names contain one of these words show the PRODUCTION warning · comma-separated')}</small></span>
          <Input aria-label={tr('운영 프로필로 볼 단어', 'Production profile words')} value={settings.productionPattern} maxLength={200} placeholder={DEFAULT_SETTINGS.productionPattern} onChange={event => updateSettings({ productionPattern: event.target.value })}/>
        </label>
      </div>
    </section>
  </ModalSurface>;
}
