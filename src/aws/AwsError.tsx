import { Copy, RefreshCw, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '../i18n';
import { awsError } from '../aws';

/** PowerShell and POSIX shells both accept a single-quoted profile with doubled quotes escaped. */
export const ssoCommand = (profile: string) => `aws sso login --profile '${profile.replaceAll("'", "''")}'`;

export function AwsError({ error, profile, onRetry }: { error: string; profile: string; onRetry?: () => void }) {
  const { t, language } = useLanguage(); const tr = (ko: string, en: string) => language === 'ko' ? ko : en;
  if (!error) return null;
  const auth = error === 'AWS_AUTH_REQUIRED';
  return <div role="alert" className="error-banner aws-error">
    <Terminal size={15}/>
    <span>{t(awsError(error))}{auth && profile && <><br/><code className="aws-login-hint">{ssoCommand(profile)}</code></>}</span>
    {auth && profile && <Button variant="ghost" size="bare" className="icon-button" title={tr('명령 복사', 'Copy command')} aria-label={tr('로그인 명령 복사', 'Copy sign-in command')} onClick={() => void navigator.clipboard?.writeText(ssoCommand(profile)).catch(() => {})}><Copy size={14}/></Button>}
    {onRetry && <Button variant="ghost" size="bare" className="icon-button" title={tr('다시 시도', 'Retry')} aria-label={tr('다시 시도', 'Retry')} onClick={onRetry}><RefreshCw size={14}/></Button>}
  </div>;
}
