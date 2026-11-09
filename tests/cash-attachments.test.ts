import {describe,it,expect} from "vitest";
import {strToU8,zipSync} from "fflate";
import {Row,cashAccountSchema,cashEntrySchema} from "../src/payments/model";
import {inspectBackup,restorePlan} from "../src/backup/service";
const proof={id:crypto.randomUUID(),name:"cash.pdf",mime:"application/pdf",size:10};
const account:Row={id:crypto.randomUUID(),kind:"cash_account",version:1,deleted:false,data:{name:"Cash",currency:"AED",openingDate:"2026-01-01",openingBalance:1000,attachment:proof}};
const entry:Row={id:crypto.randomUUID(),kind:"cash_entry",version:1,deleted:false,data:{accountId:account.id,currency:"AED",amount:100,direction:"out",date:"2026-11-09",category:"maintenance",description:"Proof",attachment:{...proof,id:crypto.randomUUID()}}};
describe("Cash attachment schemas and backup",()=>{
 it("keeps optional attachment metadata on both record kinds",()=>{expect(cashAccountSchema.parse(account.data).attachment).toEqual(proof);expect(cashEntrySchema.parse(entry.data).attachment).toEqual(entry.data.attachment);});
 it("accepts existing cash data without proof and rejects invalid files",()=>{const {attachment,...legacy}=account.data;expect(cashAccountSchema.parse(legacy).attachment).toBeUndefined();expect(()=>cashEntrySchema.parse({...entry.data,attachment:{...proof,mime:"text/html"}})).toThrow();expect(()=>cashAccountSchema.parse({...account.data,attachment:{...proof,size:10485761}})).toThrow();});
 it("validates both cash attachment files and restores parents before entries",()=>{
  const manifest={"backup.json":strToU8(JSON.stringify({format:"duetrack",version:2,rows:[entry,account]}))};
  const files={...manifest,["receipts/"+proof.id]:new Uint8Array(10),["receipts/"+entry.data.attachment.id]:new Uint8Array(10)};
  expect(inspectBackup(zipSync(files)).backup.rows).toHaveLength(2);
  expect(()=>inspectBackup(zipSync({...manifest,["receipts/"+proof.id]:new Uint8Array(10)}))).toThrow("Receipt missing");
  expect(restorePlan([], [entry,account],"Merge")[0].kind).toBe("cash_account");
 });
});
