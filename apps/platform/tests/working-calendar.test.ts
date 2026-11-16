import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateDeadline, deadlineCalculationInputSchema} from '../lib/platform/deadline-calculator';
const input=(sourceDate:string, daysCount:number)=>deadlineCalculationInputSchema.parse({sourceDate,daysCount,dayType:'business_days',includeSourceDate:false,rollRule:'none',businessCalendar:'uz-five-day'});
test('managed calendar skips public holidays and includes transferred Saturdays',()=>{
 assert.equal(calculateDeadline(input('2026-12-07',1)).dueDate,'2026-12-09');
 const transferred=calculateDeadline(input('2026-12-11',1));
 assert.equal(transferred.dueDate,'2026-12-12');
 assert.deepEqual(transferred.workingDayOverrides,['2026-12-12']);
 assert.ok(!transferred.warnings.includes('HOLIDAY_CALENDAR_UNVERIFIED'));
 assert.equal(calculateDeadline(input('2026-03-19',1)).dueDate,'2026-03-24');
 assert.equal(calculateDeadline(input('2026-05-26',1)).dueDate,'2026-06-01');
});
test('managed calendar reports incomplete future years and does not trust caller holidays',()=>{
 const result=calculateDeadline({...input('2026-12-30',1),holidays:['2027-01-04'],holidayCalendarVersion:'caller-verified'});
 assert.equal(result.dueDate,'2027-01-04');
 assert.ok(result.warnings.includes('HOLIDAY_CALENDAR_UNVERIFIED'));
 assert.equal(result.holidayCalendarVersion,'uz-five-day-2026-v1');
});
