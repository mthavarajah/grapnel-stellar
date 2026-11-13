export type ChartRange='live'|'1d'|'1w'|'1m'|'1y'|'all';
export function changeDirection(value:string|null|undefined):'positive'|'negative'|'neutral'{
 if(typeof value!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(value))return 'neutral';
 if(/^[-+]?0+(?:\.0+)?$/.test(value))return 'neutral';
 return value.startsWith('-')?'negative':'positive';
}
const spans={live:3600000,'1d':86400000,'1w':604800000,'1m':2592000000,'1y':31536000000};
/** Sparse observed history occupies its true time within the requested window. */
export function chartTimeDomain(timestamps:number[],range:ChartRange,asOf:string|null|undefined,now=Date.now()):[number,number]{
 const times=timestamps.filter(Number.isFinite).sort((a,b)=>a-b),first=times[0]??now,last=times.at(-1)??now;
 const observed=asOf?Date.parse(asOf):NaN,end=Math.max(last,Number.isFinite(observed)?observed:now);
 return [range==='all'?first:end-spans[range],end];
}
/** Do not draw a continuous line across missing exchange candle intervals. */
export function chartSegments(timestamps:number[],interval?:string):number[][]{
 const ms=({'1m':60000,'5m':300000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000} as Record<string,number>)[interval??''];
 const segments:number[][]=[];
 timestamps.forEach((timestamp,index)=>{if(!index||ms&&timestamp-timestamps[index-1]!>ms*2)segments.push([]);segments.at(-1)!.push(index);});return segments;
}
