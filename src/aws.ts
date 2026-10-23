import { invoke } from '@tauri-apps/api/core';
import type { Engine } from './model';
export type AwsCliInfo={installed:boolean;version:string;profiles:string[]};
export type AwsEnvironment={account:string;arn:string;region:string;regions:string[];regionsWarning:string|null};
export type RdsInstance={id:string;engine:string;version:string;status:string;host:string;port:number;database:string;username:string;public:boolean;supported:boolean};
export type AwsService='ec2'|'rds'|'s3'|'logs';
/** Raw CLI JSON for one resource; the UI reads only the fields it shows. */
export type AwsRow=Record<string,any>;
export type AwsPage={rows:AwsRow[];nextToken:string|null};
export type AwsBrowseQuery={profile:string;region:string;kind:'objects'|'events';resource:string;prefix?:string;nextToken?:string|null;startTime?:number;endTime?:number;pattern?:string;request?:string};
export type TopologyKind='vpcs'|'subnets'|'instances'|'databases'|'loadBalancers'|'targetGroups'|'buckets'|'targets'|'lbAttributes'|'bucketLocation'|'bucketNotifications';
export const awsCliInfo=()=>invoke<AwsCliInfo>('aws_cli_info');
export const awsEnvironment=(profile:string)=>invoke<AwsEnvironment>('aws_environment',{profile});
export const awsRdsInstances=(profile:string,region:string)=>invoke<RdsInstance[]>('aws_rds_instances',{profile,region});
export const awsListResources=(query:{service:AwsService;profile:string;region:string;nextToken?:string|null;request?:string})=>invoke<AwsPage>('aws_list_resources',{query});
export const awsBrowseResources=(query:AwsBrowseQuery)=>invoke<AwsPage>('aws_browse_resources',{query});
export const awsTopologyQuery=(query:{profile:string;region:string;kind:TopologyKind;resource?:string;nextToken?:string;request?:string})=>invoke<AwsRow>('aws_topology_query',{query});
/** Stops an in-flight CLI process started with the same request id. */
export const awsCancel=(request:string)=>invoke<void>('aws_cancel',{request}).catch(()=>{});
export const rdsEngine=(engine:string):Engine=>engine==='postgres'||engine==='aurora-postgresql'?'postgres':engine==='mariadb'?'mariadb':'mysql';
export const awsError=(reason:unknown)=>({AWS_CLI_NOT_FOUND:'AWS CLI를 찾을 수 없습니다. 설치 후 앱을 다시 열거나 다시 확인하세요.',AWS_CLI_START_FAILED:'AWS CLI를 실행할 수 없습니다. 설치와 실행 권한을 확인하세요.',AWS_AUTH_REQUIRED:'AWS 인증이 만료되었거나 없습니다. 터미널에서 해당 프로필로 로그인한 뒤 다시 시도하세요.',AWS_ACCESS_DENIED:'AWS 조회 권한이 없습니다. 선택한 프로필의 IAM 권한을 확인하세요.',AWS_NETWORK_ERROR:'AWS에 연결하지 못했습니다. 네트워크와 프록시 설정을 확인하세요.',AWS_TIMEOUT:'AWS 조회 시간이 초과되었습니다. 다시 시도하세요.',AWS_INVALID_SELECTION:'프로필과 리전을 확인하세요.',AWS_INVALID_RESPONSE:'AWS CLI 응답을 읽을 수 없습니다.',AWS_CLI_FAILED:'AWS CLI 요청이 실패했습니다. 터미널에서 해당 프로필의 설정을 확인하세요.',AWS_BUSY:'AWS 요청이 많아 잠시 기다려야 합니다. 다시 시도하세요.',AWS_RESPONSE_TOO_LARGE:'AWS 응답이 너무 큽니다. 조회 범위를 줄이세요.',AWS_NOT_FOUND:'AWS 리소스를 찾을 수 없습니다. 삭제되었거나 다른 리전에 있을 수 있습니다.',AWS_CANCELLED:'AWS 요청을 취소했습니다.',AWS_REVIEW_EXPIRED:'검토가 만료되었습니다. 작업을 다시 검토하세요.',AWS_CONFIRMATION_MISMATCH:'확인 문구가 일치하지 않습니다.',AWS_ACCOUNT_CHANGED:'검토 이후 프로필의 AWS 계정이 바뀌었습니다. 작업을 실행하지 않았습니다.',AWS_ACTIONS_DISABLED:'AWS 변경 작업이 꺼져 있습니다. 설정에서 켜세요.'}[String(reason)]??'AWS CLI 요청이 실패했습니다. 터미널에서 해당 프로필의 설정을 확인하세요.');
export type AwsAction='ec2Start'|'ec2Stop'|'ec2Reboot'|'ec2Terminate'|'ec2Rename'|'rdsStart'|'rdsStop'|'rdsReboot'|'rdsSnapshot'|'s3Versioning'|'logsRetention'|'logsRetainForever'|'logsDelete';
export type AwsReview={review:string;account:string;phrase:string;command:string};
export const awsPrepareAction=(query:{profile:string;region:string;action:AwsAction;resource:string;value?:string})=>invoke<AwsReview>('aws_prepare_action',{query});
export const awsRunAction=(review:string,confirmation:string)=>invoke<AwsRow>('aws_run_action',{review,confirmation});
export const awsCancelAction=(review:string)=>invoke<void>('aws_cancel_action',{review}).catch(()=>{});
