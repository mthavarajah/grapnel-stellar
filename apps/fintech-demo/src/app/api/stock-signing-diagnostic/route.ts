import{NextRequest}from'next/server';import{z}from'zod';
import{assertOrigin,requireSession,json,failure}from'../../../lib/server';
import{stockSigningDiagnostic}from'../../../lib/stock-signing-diagnostic';
export async function POST(request:NextRequest){try{assertOrigin(request);await requireSession();const value=z.object({stage:z.enum(['network','provider','signing','submission','execution']),name:z.string().max(240),code:z.string().max(240),message:z.string().max(240)}).strict().parse(await request.json());console.error('[stock-signing]',JSON.stringify(stockSigningDiagnostic(value.stage,value)));return json({recorded:true});}catch(cause){return failure(cause);}}
