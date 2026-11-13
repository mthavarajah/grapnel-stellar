import {chartPrice} from './chart-presentation';
import{describe,expect,it}from'vitest';import{changeDirection,chartTimeDomain,chartSegments}from'./chart-presentation';
it('preserves the exact sign even for tiny changes and negative zero',()=>{expect(changeDirection('-0.000000000000000001')).toBe('negative');expect(changeDirection('0.000000000000000001')).toBe('positive');for(const n of ['0','-0.00','+0',null,'bad'])expect(changeDirection(n)).toBe('neutral');});
it('does not stretch two hours of recorded stock prices across every selected range',()=>{const end=Date.parse('2026-11-13T20:00:00Z'),points=[end-7200000,end];expect(chartTimeDomain(points,'1d',new Date(end).toISOString())).toEqual([end-86400000,end]);expect(chartTimeDomain(points,'1y',new Date(end).toISOString())).toEqual([end-31536000000,end]);expect(chartTimeDomain(points,'all',new Date(end).toISOString())).toEqual([points[0],end]);});

it('leaves actual exchange data gaps empty instead of connecting years without candles',()=>{expect(chartSegments([0,60000,120000,86400000,86460000],'1m')).toEqual([[0,1,2],[3,4]]);});

describe('chart hover price display',()=>{
 it.each([['390.223456789','390.22'],['12345.6789','12,345.68'],['1','1.00'],['0','0.00'],['0.147110539','0.1471'],['0.000078123456','0.00007812'],['0.999999','1.0000']])('formats %s with useful precision', (input,expected)=>expect(chartPrice(input)).toBe(expected));
});

it('joins expected equity overnight/weekend closures without removing actual timestamps',()=>{expect(chartSegments([0,86400000,4*86400000,5*86400000],'1d',true)).toEqual([[0,1,2,3]]);expect(chartSegments([0,86400000,8*86400000],'1d',true)).toEqual([[0,1],[2]]);});
