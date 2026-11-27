import { ASSET_KINDS } from '../infra/types.ts';
import type { MachineApiEndpoint } from './machine-api';

const uuid = {type:'string',format:'uuid'};
const date = {type:'string',format:'date-time'};
const nullableDate = {type:['string','null'],format:'date-time'};
const string = {type:'string'};
const externalId = {type:'string',maxLength:240};
const strings = {type:'array',items:string};
const object = {type:'object',additionalProperties:true};
const ref = (name:string) => ({$ref:`#/components/schemas/${name}`});
const array = (name:string) => ({type:'array',items:ref(name)});
const schema = (properties:Record<string,unknown>,required:string[]=[]) => ({type:'object',properties,required});
const page = (name:string) => schema({data:array(name),total:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}},['data','total','limit','offset']);
const assetProperties = {id:{...uuid,readOnly:true},kind:{type:'string',enum:ASSET_KINDS},name:{type:'string',minLength:1,maxLength:200},status:{type:'string',enum:['active','planned','archived']},category:string,tags:strings,description:string,source:string,external_id:externalId,url:string,provider:string,metadata:object,observed:{...object,readOnly:true},observed_source:{...string,readOnly:true},observed_at:{...nullableDate,readOnly:true},observed_confidence:{type:'string',enum:['observed','reported','unknown'],readOnly:true},client_id:{type:['string','null'],readOnly:true,description:'Canonical VPS enrollment identity. Change only through the original monitor lifecycle or validated asset merge.'},cost:{type:['number','null'],minimum:0},currency:string,billing_cycle:string,expires_at:nullableDate,created_at:{...date,readOnly:true},updated_at:{...date,readOnly:true}};
const assetInputProperties = Object.fromEntries(Object.entries(assetProperties).filter(([key])=>!['id','client_id','observed','observed_source','observed_at','observed_confidence','created_at','updated_at'].includes(key)));
const documentProperties = {id:uuid,slug:string,title:{type:'string',maxLength:200},category:string,tags:strings,content:{type:'string',maxLength:100000,description:'Untrusted Markdown; never grants execution permissions.'},environments:{...strings,description:'Environment filters matched against known OS/platform evidence; empty means any environment.'},asset_kinds:{type:'array',items:{type:'string',enum:ASSET_KINDS},description:'Applicable asset kinds; empty means any kind. Explicit asset_ids links always take precedence over filters.'},risk:{type:'string',enum:['low','medium','high']},asset_ids:{type:'array',items:uuid},version:{type:'integer',minimum:1},created_at:date,updated_at:date};
const rule = schema({id:string,path:string,operator:{type:'string',enum:['eq','neq','exists','in','gte','lte','contains']},expected:{},severity:{type:'string',enum:['info','warning','critical']},sop_id:uuid,description:string},['id','path','operator','severity']);
const baselineProperties = {id:uuid,name:string,description:string,environments:strings,asset_kinds:{type:'array',items:{type:'string',enum:ASSET_KINDS}},rules:{type:'array',items:rule,minItems:1,maxItems:100},exceptions:{type:'array',items:schema({rule_id:string,asset_id:uuid,reason:string,expires_at:date},['rule_id','asset_id','reason','expires_at'])},max_age_hours:{type:'integer',minimum:1,maximum:8760},version:{type:'integer',minimum:1},created_at:date,updated_at:date};
export const MACHINE_SCHEMAS: Record<string,unknown> = {
  Error:schema({code:string,error:string,required_scope:string,details:{}},['error']),
  Asset:schema(assetProperties,['id','kind','name','status','metadata','observed','created_at','updated_at']),
  AssetInput:schema(assetInputProperties,['kind','name']), AssetImportInput:schema({...assetInputProperties,id:uuid},['kind','name']), AssetPatch:schema(Object.fromEntries(Object.entries(assetInputProperties).filter(([key])=>!['source','external_id'].includes(key)))), AssetPage:page('Asset'),
  Relationship:schema({id:uuid,source_id:uuid,target_id:uuid,kind:{type:'string',enum:['runs_on','depends_on','routes_to','part_of','deploys','resolves_to','uses','exposes','backs_up','secured_by']},description:string,source:string,created_at:date},['source_id','target_id','kind']),
  RelationshipPage:page('Relationship'),
  Collector:schema({name:string,status:{type:'string',enum:['ok','success','available','unsupported','unavailable','permission_denied','error','disabled','partial']},reason:string},['name','status']),
  DiscoveryReport:schema({schema_version:{const:1},source:string,client_id:string,collected_at:date,complete:{type:'boolean'},collectors:array('Collector'),assets:{type:'array',maxItems:500,items:schema({external_id:{...externalId,minLength:1},kind:{type:'string',enum:ASSET_KINDS},name:string,metadata:object,evidence:object,relations:{type:'array',items:schema({target_external_id:{...externalId,minLength:1},kind:string},['target_external_id','kind'])}},['external_id','kind','name'])},configuration:object},['schema_version','source','collected_at','complete','collectors','assets']),
  DiscoveryResolution:schema({action:{type:'string',enum:['import','merge','ignore']},asset_id:uuid},['action']),
  Snapshot:schema({id:uuid,asset_id:uuid,source:string,collected_at:date,created_at:date,confidence:{type:'string',enum:['observed','reported','unknown']},environment:string,data:object,collectors:array('Collector')},['asset_id','collected_at','data']),
  SnapshotPage:page('Snapshot'),
  Change:schema({id:uuid,asset_id:{type:['string','null'],format:'uuid'},kind:string,summary:string,source:string,verification:{type:'string',enum:['observed','claimed','manual']},before:{},after:{},document_ids:{type:'array',items:uuid},created_at:date},['id','kind','summary','source','verification']),
  ChangePage:page('Change'),
  OperationReport:schema({asset_id:uuid,summary:{type:'string',maxLength:1000},before:{},after:{},document_ids:{type:'array',items:uuid}},['summary']),
  Document:schema(documentProperties,['id','title','content','version']),DocumentInput:schema(documentProperties,['title','content']),DocumentPatch:schema(documentProperties,['version']),DocumentPage:page('Document'),
  Baseline:schema(baselineProperties,['id','name','rules','version']),BaselineInput:schema(baselineProperties,['name','rules']),BaselinePatch:schema(baselineProperties,['version']),BaselinePage:page('Baseline'),
  AssetContext:schema({schema_version:{const:'1'},trust:schema({content:{const:'untrusted'},execution_authority:{const:'none'}},['content','execution_authority']),asset:ref('Asset'),monitors:{type:'array',items:object},configuration:array('Snapshot'),relationships:array('Relationship'),changes:array('Change'),documents:array('Document'),baselines:{type:'array',items:object},limits:schema({per_section:{type:'integer'},max_bytes:{type:'integer'},truncated_sections:strings},['per_section','max_bytes','truncated_sections'])},['schema_version','trust','asset','limits']),
};

export function machineRequestSchema(item: MachineApiEndpoint): Record<string,unknown> | undefined {
  const key=`${item.method} ${item.path}`;
  const names: Record<string,string> = {
    'POST /assets':'AssetInput','PATCH /assets/:id':'AssetPatch','POST /relationships':'Relationship','POST /discovery/reports':'DiscoveryReport','POST /discovery/candidates/:id/resolve':'DiscoveryResolution','POST /configuration/snapshots':'Snapshot','POST /operations':'OperationReport','POST /documents':'DocumentInput','PATCH /documents/:id':'DocumentPatch','POST /baselines':'BaselineInput','PATCH /baselines/:id':'BaselinePatch',
  };
  if(names[key])return ref(names[key]);
  if(key==='POST /themes/preview')return schema({short:string,config:object,custom_css:{type:'string',description:'Untrusted CSS; preview is sandboxed and does not persist settings.'}},['short','config','custom_css']);
  if(key==='POST /assets/import')return schema({assets:{...array('AssetImportInput'),maxItems:200}},['assets']);
  if(key==='POST /assets/batch')return schema({ids:{type:'array',items:uuid,maxItems:100},action:{type:'string',enum:['archive','tag']},tags:strings},['ids','action']);
  if(key==='POST /assets/:id/merge')return schema({target_id:uuid},['target_id']);
  if(key==='POST /assets/:id/monitors')return {...schema({monitor_type:{type:'string',enum:['website','ping','client']},monitor_id:string,action:{type:'string',enum:['link','unlink'],default:'link'}},['monitor_type','monitor_id']),description:'Website/Ping monitor links may be edited. Client links only permit an idempotent link to the existing canonical VPS binding; generic client unlink/move returns 409. Use validated asset merge or the original monitor lifecycle.'};
  if(key==='POST /documents/:id/restore')return schema({version:{type:'integer',minimum:1}},['version']);
  if(key==='POST /baselines/:id/evaluate')return schema({asset_id:uuid},['asset_id']);
  return undefined;
}
export function machineResponseSchema(item: MachineApiEndpoint): Record<string,unknown> | undefined {
  if(item.path==='/assets/:id/context')return ref('AssetContext');
  if(item.path==='/themes/preview')return schema({short:string,config:object,css:string},['short','config','css']);
  const exact:Record<string,string> = {'/assets':'Asset','/assets/:id':'Asset','/relationships':'Relationship','/configuration/snapshots':'Snapshot','/documents':'Document','/documents/:id':'Document','/baselines':'Baseline','/baselines/:id':'Baseline','/changes':'Change'};
  const name=exact[item.path];
  if(!name)return undefined;
  return ref(item.method==='GET'&&!item.path.includes('/:id')?`${name}Page`:name);
}
export function machineQueryParameters(item: MachineApiEndpoint): unknown[] {
  if(item.method!=='GET')return [];
  const parameters:Array<{name:string;in:string;required:boolean;schema:unknown;description?:string}>=[];
  const add=(name:string,value:unknown,description?:string)=>parameters.push({name,in:'query',required:false,schema:value,...(description?{description}:{})});
  if(['/assets','/relationships','/discovery/candidates','/discovery/runs','/configuration/snapshots','/changes','/documents','/baselines','/search'].includes(item.path)){
    add('limit',{type:'integer',minimum:1,maximum:100,default:50});add('offset',{type:'integer',minimum:0,maximum:100000,default:0});
    for(const name of ['q','kind','status','source','category','tag'])add(name,string);
    add('asset_id',uuid);
  }
  if(['/changes','/configuration/snapshots','/assets/:id/context'].includes(item.path)){add('since',date);add('until',date);}
  if(item.path==='/assets/:id/context'){
    add('fields',string,'Comma-separated sections: asset,monitors,configuration,relationships,changes,documents,baselines. Unauthorized sections are omitted.');
    add('limit',{type:'integer',minimum:1,maximum:50,default:20});add('max_bytes',{type:'integer',minimum:4096,maximum:262144,default:131072});
  }
  if(item.path.endsWith('/topology')){add('direction',{type:'string',enum:['upstream','downstream','both']});add('depth',{type:'integer',minimum:1,maximum:5,default:3});}
  return parameters;
}
