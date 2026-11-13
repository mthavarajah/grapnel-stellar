/** Official high-resolution artwork. Trading is a separate product descriptor. */
export function VelocityBrand({compact=false}:{compact?:boolean}){
 if(compact)return <img className="velocity-compact-mark" src="/brand/velocity-official-icon.png" alt="Velocity" width={32} height={32}/>;
 return <span className="velocity-brand-lockup"><span className="velocity-wordmark"><img src="/brand/velocity-official-wordmark-hd.png" alt="Velocity" width={679} height={213}/></span><span className="velocity-trading-label">Trading</span></span>;
}
