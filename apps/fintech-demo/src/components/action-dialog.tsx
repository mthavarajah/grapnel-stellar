"use client";
import{useEffect,useId,useRef,type ReactNode}from'react';
import{createPortal}from'react-dom';
/** A review can be dismissed without cancelling or resending the retained request. */
export function ActionDialog({title,onClose,children,suspendFocus=false}:{title:string;onClose:()=>void;children:ReactNode;suspendFocus?:boolean}){
 const titleId=useId(),panel=useRef<HTMLElement>(null),close=useRef(onClose),suspended=useRef(suspendFocus);close.current=onClose;suspended.current=suspendFocus;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';panel.current?.focus();
  const key=(event:KeyboardEvent)=>{if(suspended.current)return;if(event.key==='Escape'){event.preventDefault();close.current();return;}if(event.key!=='Tab')return;
   const elements=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[]).filter(node=>node.getClientRects().length>0),first=elements[0],last=elements.at(-1);
   if(!first){event.preventDefault();panel.current?.focus();}else if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){event.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
 },[]);
 if(typeof document==='undefined')return null;
 return createPortal(<div className="modal-backdrop" role="presentation"><section className="modal stock-action-modal" role="dialog" aria-modal={!suspendFocus} aria-labelledby={titleId} tabIndex={-1} ref={panel}><button type="button" className="close" aria-label="Close stock transaction" onClick={onClose}>×</button><p className="eyebrow">STOCK TRANSACTION</p><h2 id={titleId}>{title}</h2>{children}</section></div>,document.body);
}
