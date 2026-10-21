import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Cloud, Database, Loader2, LockKeyhole, Play, X } from 'lucide-react';
import { ModalSurface } from '@/components/ModalSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AwsConnection } from './AwsConnection';
import { rdsEngine, type RdsInstance } from './aws';
import { useLanguage } from './i18n';
import type { Engine, Profile } from './model';
import * as api from './api';
export function ConnectionDialog({onClose,onConnected,initialProfile,onSave,onPasswordForgotten,saveDisabled=false}:{onClose:()=>void;onConnected:(p:Profile,id:string)=>void|Promise<void>;initialProfile?:Profile;onSave?:(p:Profile)=>void|Promise<void>;onPasswordForgotten?:(id:string)=>void;saveDisabled?:boolean}) {
 const {t,language}=useLanguage(); const tr=(ko:string,en:string)=>language==='ko'?ko:en;
 const [mode,setMode]=useState<'direct'|'aws'>('direct'),[rdsSelected,setRdsSelected]=useState(false);
 const [profile,setProfile]=useState<Profile>(initialProfile ?? {id:crypto.randomUUID(),name:'Local PostgreSQL',engine:'postgres',host:'localhost',port:5432,database:'postgres',username:'postgres',password:'',tls:true});
 const [loading,setLoading]=useState(false),[message,setMessage]=useState('');
 const [credential,setCredential]=useState<api.CredentialStatus>({supported:false,saved:false,available:false});
 useEffect(()=>{let cancelled=false;setCredential({supported:false,saved:false,available:false});void api.credentialStatus(profile).then(status=>{if(!cancelled)setCredential(status??{supported:false,saved:false,available:false});}).catch(()=>{if(!cancelled)setMessage(tr('저장된 비밀번호를 확인하지 못했습니다. 비밀번호를 입력하거나 저장된 비밀번호를 삭제한 뒤 다시 시도하세요.','Could not check saved credentials. Enter a password or delete the saved password and try again.'));});return()=>{cancelled=true;};},[profile.id,profile.engine,profile.host,profile.port,profile.database,profile.username,profile.tls]);
 const field=(key:keyof Profile,value:string|number|boolean)=>{setMessage('');setProfile(p=>({...p,[key]:value,...(['host','port','database','username','tls'].includes(key)&&p[key]!==value?{password:''}:{})}));};
 async function forget(){
  setLoading(true);setMessage('');
  try{await api.forgetPassword(profile.id);setProfile(p=>({...p,password:'',rememberPassword:false}));setCredential(s=>({...s,saved:false,available:false}));onPasswordForgotten?.(profile.id);setMessage(tr('저장된 비밀번호를 삭제했습니다.','Saved password deleted.'));}
  catch(e){setMessage(String(e));}finally{setLoading(false);}
 }
 async function save(){
  if(!onSave||loading||saveDisabled)return;
  setLoading(true);setMessage('');
  try{
   if(profile.engine!=='sqlite'&&profile.rememberPassword&&(profile.password||!credential.saved)){
    const id=await api.connect(profile);await api.disconnect(id);
   }else if(!profile.rememberPassword&&credential.saved){await api.forgetPassword(profile.id);onPasswordForgotten?.(profile.id);}
   await onSave({...profile,password:''});
  }catch(e){setMessage(String(e));}finally{setLoading(false);}
 }
 function selectRds(instance:RdsInstance|null,region:string){
  setMessage('');setRdsSelected(!!instance);
  if(!instance){setProfile(p=>({...p,host:'',database:'',username:'',password:''}));return;}
  const engine=rdsEngine(instance.engine);
  setProfile(p=>({...p,name:`${instance.id} (${region})`,engine,host:instance.host,port:instance.port,database:instance.database||(engine==='postgres'?'postgres':''),username:instance.username,password:'',tls:true}));
 }
 async function submit(test:boolean){
  if(!api.desktop||loading||mode==='aws'&&!rdsSelected)return;
  if(!profile.name.trim()||(profile.engine==='sqlite'&&!profile.database.trim())||(profile.engine!=='sqlite'&&(!profile.host.trim()||!profile.username.trim()||!Number.isInteger(profile.port)||profile.port<1||profile.port>65535))){setMessage(t('연결 이름, 호스트, DB, 사용자와 유효한 포트를 입력하세요.'));return;}
  setLoading(true);setMessage('');
  try{const id=await api.connect(profile);setProfile(p=>({...p,password:''}));if(test){await api.disconnect(id);setCredential(await api.credentialStatus(profile));setMessage(t('연결에 성공했습니다.'));}else await onConnected({...profile,password:''},id);}
  catch(reason){setMessage(String(reason));}finally{setLoading(false);}
 }
 const unavailable=!api.desktop||loading||mode==='aws'&&!rdsSelected;
 return <ModalSurface title={t('새 연결')} onClose={onClose} locked={loading}><form role="dialog" aria-modal="true" aria-label={t('새 연결')} className={`modal connection-modal ${mode==='aws'?'aws-connection-modal':''}`} onSubmit={event=>{event.preventDefault();void submit(false);}}>
  <div className="connection-scroll">
  <div className="modal-heading"><div className="modal-symbol"><Database size={22}/></div><Button type="button" variant="ghost" size="icon-sm" disabled={loading} onClick={onClose} aria-label={t('닫기')}><X size={20}/></Button></div>
  <h2>{t('새 연결')}</h2>
  {!api.desktop&&<p className="connection-availability">{tr('데이터베이스 연결은 데스크톱 앱에서 사용할 수 있습니다.','Database connections are available in the desktop app.')}</p>}
  <div className="connection-methods" aria-label={t('연결 방법')}>
   <Button type="button" variant={mode==='direct'?'secondary':'ghost'} size="sm" aria-pressed={mode==='direct'} disabled={loading} onClick={()=>{setMode('direct');setMessage('');}}><Database size={14}/>{t('직접 연결')}</Button>
   <Button type="button" variant={mode==='aws'?'secondary':'ghost'} size="sm" aria-pressed={mode==='aws'} disabled={loading||!api.desktop} onClick={()=>{if(mode!=='aws'){setMode('aws');setRdsSelected(false);setMessage('');}}}><Cloud size={14}/>AWS RDS</Button>
  </div>
  <div className={mode==='aws'&&rdsSelected?'aws-connection-grid':''}>
  {mode==='aws'&&<AwsConnection disabled={loading} onSelect={selectRds}/>}
  <fieldset className="connection-fields" disabled={loading}>
   {mode==='direct'?<div className="engine-options">{(['postgres','mysql','mariadb','sqlite'] as Engine[]).map(engine=><Button type="button" variant="ghost" size="bare" key={engine} className={profile.engine===engine?'active':''} onClick={()=>{setMessage('');setProfile(p=>({...p,engine,port:engine==='postgres'?5432:3306,username:engine==='postgres'?'postgres':'root',database:engine==='sqlite'?'':engine==='postgres'?'postgres':'mysql',name:engine==='sqlite'?'Local SQLite':engine==='postgres'?'Local PostgreSQL':engine==='mysql'?'Local MySQL':'Local MariaDB',password:''}));}}><Database size={20}/>{engine==='sqlite'?'SQLite':engine==='postgres'?'PostgreSQL':engine==='mysql'?'MySQL':'MariaDB'}</Button>)}</div>:rdsSelected&&<p className="connection-engine">{profile.engine==='postgres'?'PostgreSQL':profile.engine==='mysql'?'MySQL':'MariaDB'}</p>}
   {(mode==='direct'||rdsSelected)&&<>
    <label>{t('연결 이름')}<Input aria-label={t('연결 이름')} value={profile.name} onChange={e=>field('name',e.target.value)}/></label>
    {profile.engine!=='sqlite'&&<div className="form-row"><label>{t('호스트')}<Input aria-label={t('호스트')} value={profile.host} onChange={e=>field('host',e.target.value)}/></label><label className="port">{t('포트')}<Input aria-label={t('포트')} type="number" value={profile.port} onChange={e=>field('port',Number(e.target.value))}/></label></div>}
    <label>{profile.engine==='sqlite'?tr('SQLite 파일 경로','SQLite file path'):t('데이터베이스')}<Input aria-label={t('데이터베이스')} value={profile.database} onChange={e=>field('database',e.target.value)}/></label>{profile.engine!=='sqlite'&&<p className="credential-note">{profile.engine==='postgres'?tr('선택 사항 · 비워두면 postgres DB에 연결하여 해당 DB의 스키마를 조회합니다.','Optional · Leave blank to connect to postgres and browse its schemas.'):tr('선택 사항 · 비워두면 기본 DB 없이 연결하여 접근 가능한 모든 스키마를 조회합니다.','Optional · Leave blank to browse all accessible schemas without a default database.')}</p>}{profile.engine==='sqlite'&&api.desktop&&<div className="sqlite-file-actions"><Button type="button" variant="outline" size="sm" onClick={()=>void invoke<string|null>('choose_sqlite_file',{create:false}).then(path=>{if(path)field('database',path);}).catch(e=>setMessage(String(e)))}>{tr('파일 선택','Choose file')}</Button><Button type="button" variant="outline" size="sm" onClick={()=>void invoke<string|null>('choose_sqlite_file',{create:true}).then(path=>{if(path)field('database',path);}).catch(e=>setMessage(String(e)))}>{tr('새 파일','New file')}</Button></div>}
    {profile.engine!=='sqlite'&&<><div className="form-row"><label>{t('사용자')}<Input aria-label={t('사용자')} value={profile.username} onChange={e=>field('username',e.target.value)}/></label><label>{t('비밀번호')}<Input aria-label={t('비밀번호')} type="password" autoComplete="off" placeholder={credential.saved?tr('저장된 비밀번호 사용','Use saved password'):credential.available?tr('이번 실행에서 기억한 비밀번호 사용','Use password from this session'):''} value={profile.password} onChange={e=>field('password',e.target.value)}/></label></div>
    <label className="checkbox-label"><Input type="checkbox" checked={profile.tls} onChange={e=>field('tls',e.target.checked)}/>{t('TLS 사용 · 서버 인증서 검증')}</label>
    <label className="checkbox-label"><Input type="checkbox" checked={profile.rememberPassword??false} disabled={!credential.supported&&!profile.rememberPassword} onChange={e=>field('rememberPassword',e.target.checked)}/>{tr('이 PC에 비밀번호 기억','Remember password on this PC')}</label>
    {credential.saved&&<p className="credential-note">{tr('비밀번호 저장됨 · 다음 실행 시 마지막 연결에 자동 접속합니다.','Password saved · Reconnects to the last connection on startup.')}</p>}
    {(credential.saved||credential.available||profile.rememberPassword)&&<Button type="button" variant="outline" size="sm" onClick={()=>void forget()}>{tr('저장된 비밀번호 삭제','Delete saved password')}</Button>}
    <p className="credential-note"><LockKeyhole size={13}/><span>{tr('선택 시 연결에 성공한 비밀번호를 Windows 자격 증명 관리자에 암호화하여 저장합니다.','When selected, successfully authenticated passwords are encrypted in Windows Credential Manager.')}</span></p></>}
    <div className="form-row"><label>{tr('그룹','Group')}<Input value={profile.group??''} onChange={e=>field('group',e.target.value)}/></label><label>{tr('환경','Environment')}<NativeSelect aria-label={tr('환경','Environment')} value={profile.environment??'development'} onChange={e=>field('environment',e.target.value)}><NativeSelectOption value="development">Development</NativeSelectOption><NativeSelectOption value="staging">Staging</NativeSelectOption><NativeSelectOption value="production">Production</NativeSelectOption></NativeSelect></label></div><label className="checkbox-label"><Input type="checkbox" checked={profile.readOnly??false} onChange={e=>field('readOnly',e.target.checked)}/>{tr('읽기 전용 연결','Read-only connection')}</label>
   </>}
  </fieldset>
  </div>
  {message&&<p role="status" className="dialog-message">{message}</p>}
  </div>
  <div className="modal-actions">{onSave&&<Button type="button" variant="outline" size="sm" disabled={(!api.desktop&&!!profile.rememberPassword)||loading||saveDisabled||!profile.name.trim()||(profile.engine==='sqlite'&&!profile.database.trim())} title={saveDisabled?tr('연결 중인 프로필은 다시 연결하여 변경 내용을 적용하세요.','Reconnect to apply changes to an active profile.'):undefined} onClick={()=>void save()}>{tr('프로필 저장','Save profile')}</Button>}<Button type="button" variant="outline" size="sm" disabled={unavailable} onClick={()=>void submit(true)}>{t('연결 테스트')}</Button><Button type="submit" variant="default" size="sm" disabled={unavailable}>{loading?<Loader2 size={15} className="spin"/>:<Play size={15}/>} {t('연결하기')}</Button></div>
 </form></ModalSurface>;
}
