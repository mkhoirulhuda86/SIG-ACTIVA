import { createHmac, timingSafeEqual } from 'crypto';
import { sanitizeWorkbookName } from '@/lib/cost-structure/uploads';

export type RawV2PendingUpload={companyCode:string;fiscalYear:number;fiscalPeriod:number;fileName:string;fileSize:number;objectKey:string;userId:number;expiresAt:number};
const secret=()=>process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET||'';

export function createRawV2StorageKey(companyCode:string,year:number,period:number,fileName:string,token:string){return `cost-structure/raw-v2/${companyCode.replace(/[^A-Za-z0-9_-]/g,'')}/${year}/${String(period).padStart(2,'0')}/${token.replace(/[^A-Za-z0-9-]/g,'')}-${sanitizeWorkbookName(fileName)}`;}
export function signRawV2PendingUpload(value:RawV2PendingUpload){if(!secret())throw new Error('Upload signing secret is not configured');const body=Buffer.from(JSON.stringify(value)).toString('base64url');return `${body}.${createHmac('sha256',secret()).update(body).digest('base64url')}`;}
export function verifyRawV2PendingUpload(token:string){const [body,signature]=token.split('.');if(!body||!signature||!secret())return null;const expected=createHmac('sha256',secret()).update(body).digest(),actual=Buffer.from(signature,'base64url');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;try{const value=JSON.parse(Buffer.from(body,'base64url').toString()) as RawV2PendingUpload;return value.expiresAt>Date.now()?value:null;}catch{return null;}}
