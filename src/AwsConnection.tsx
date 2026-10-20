import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useLanguage } from './i18n';
import { awsCliInfo, awsEnvironment, awsRdsInstances, awsError, type AwsCliInfo, type AwsEnvironment, type RdsInstance } from './aws';
export function AwsConnection({disabled,onSelect}:{disabled:boolean;onSelect:(instance:RdsInstance|null,region:string)=>void}){
 const {t}=useLanguage();
 const [info,setInfo]=useState<AwsCliInfo|null>(null),[profile,setProfile]=useState(''),[env,setEnv]=useState<AwsEnvironment|null>(null),[region,setRegion]=useState('');
 const [instances,setInstances]=useState<RdsInstance[]|null>(null),[selected,setSelected]=useState(''),[loading,setLoading]=useState(''),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[retry,setRetry]=useState(0);
 const callback=useRef(onSelect);callback.current=onSelect;const request=useRef(0);
 useEffect(()=>{
  let cancelled=false;setLoading('cli');setError('');setInfo(null);setProfile('');setEnv(null);setRegion('');setInstances(null);setSelected('');callback.current(null,'');request.current++;
  awsCliInfo().then(value=>{if(!cancelled)setInfo(value);}).catch(reason=>{if(!cancelled)setError(awsError(reason));}).finally(()=>{if(!cancelled)setLoading('');});
  return()=>{cancelled=true;request.current++;};
 },[refresh]);
 useEffect(()=>{
  if(!profile)return;let cancelled=false;setLoading('profile');setError('');setEnv(null);setRegion('');setInstances(null);setSelected('');callback.current(null,'');request.current++;
  awsEnvironment(profile).then(value=>{if(!cancelled){setEnv(value);setRegion(value.region);}}).catch(reason=>{if(!cancelled)setError(awsError(reason));}).finally(()=>{if(!cancelled)setLoading('');});
  return()=>{cancelled=true;request.current++;};
 },[profile,retry]);
 async function discover(){
  const token=++request.current;setLoading('rds');setError('');setInstances(null);setSelected('');callback.current(null,region);
  try{const rows=await awsRdsInstances(profile,region.trim());if(token===request.current)setInstances(rows);}
  catch(reason){if(token===request.current)setError(awsError(reason));}
  finally{if(token===request.current)setLoading('');}
 }
 const instance=instances?.find(item=>item.id===selected);
 return <div className="aws-discovery" aria-busy={!!loading}>
  <div className="aws-heading"><strong>AWS CLI</strong><span>{info?.version.split(' ')[0]}</span><Button type="button" variant="ghost" size="icon-sm" disabled={disabled||!!loading} aria-label={t('AWS CLI 다시 확인')} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={14}/></Button></div>
  {loading&&<p role="status" className="aws-status"><Loader2 size={14} className="spin"/>{t('AWS 정보 조회 중…')}</p>}
  {info&&!info.installed&&<p role="status">{t('AWS CLI를 찾을 수 없습니다. 설치 후 앱을 다시 열거나 다시 확인하세요.')}</p>}
  {info?.installed&&!info.profiles.length&&<p role="status">{t('저장된 AWS 프로필이 없습니다. aws configure 또는 aws configure sso로 프로필을 추가하세요.')}</p>}
  {!!info?.profiles.length&&<label>{t('AWS 프로필')}<NativeSelect aria-label={t('AWS 프로필')} value={profile} disabled={disabled||!!loading} onChange={e=>setProfile(e.target.value)}><NativeSelectOption value="">{t('프로필 선택')}</NativeSelectOption>{info.profiles.map(value=><NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect></label>}
  {profile&&!loading&&!env&&<Button type="button" variant="outline" size="sm" onClick={()=>setRetry(v=>v+1)}>{t('인증 다시 확인')}</Button>}
  {env&&<><p className="aws-account" title={env.arn}>{t('AWS 계정')} <strong>{env.account}</strong></p>
   {env.regionsWarning&&<p className="structure-note">{t('리전 목록을 조회하지 못했습니다. 리전 코드를 직접 입력할 수 있습니다.')}</p>}
   <div className="aws-region-row"><label>{t('AWS 리전')}<Input aria-label={t('AWS 리전')} list="aws-regions" value={region} disabled={disabled||!!loading} onChange={e=>{request.current++;setRegion(e.target.value);setInstances(null);setSelected('');setError('');callback.current(null,e.target.value);}} placeholder="ap-northeast-2"/><datalist id="aws-regions">{env.regions.map(value=><option key={value} value={value}/>)}</datalist></label><Button type="button" variant="outline" size="sm" disabled={disabled||!!loading||!region.trim()} onClick={()=>void discover()}>{t('RDS 조회')}</Button></div>
  </>}
  {instances&&instances.length===0&&<p role="status">{t('선택한 리전에 RDS 인스턴스가 없습니다.')}</p>}
  {!!instances?.length&&<label>{t('RDS 인스턴스')}<NativeSelect aria-label={t('RDS 인스턴스')} value={selected} disabled={disabled||!!loading} onChange={e=>{setSelected(e.target.value);callback.current(instances.find(item=>item.id===e.target.value)??null,region.trim());}}><NativeSelectOption value="">{t('인스턴스 선택')}</NativeSelectOption>{instances.map(item=><NativeSelectOption key={item.id} value={item.id} disabled={!item.supported||!item.host||!item.port||item.status!=='available'}>{item.id} · {item.engine} {item.version} · {item.status}{!item.supported?' · '+t('지원하지 않는 엔진'):''}</NativeSelectOption>)}</NativeSelect></label>}
  {instance&&<div className="aws-instance-info"><code>{instance.host}:{instance.port}</code><p>{t(instance.public?'보안 그룹에서 현재 PC의 DB 접속을 허용해야 합니다.':'사설 RDS입니다. 접속 가능한 VPN 또는 터널이 필요합니다.')}</p><p>{t('AWS 프로필은 RDS 조회에 사용됩니다. DB 비밀번호는 별도로 입력하세요.')}</p></div>}
  {error&&<p role="alert" className="dialog-error">{t(error)}{profile&&error.includes('인증')&&<code className="aws-login-hint">{t("SSO 프로필인 경우")}: aws sso login --profile {`'${profile.replaceAll("'", "''")}'`}</code>}</p>}
 </div>;
}
