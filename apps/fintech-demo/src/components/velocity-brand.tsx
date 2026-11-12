/** Official first-party artwork; the full source bitmap stays unchanged.
 * The wordmark viewport exposes only its Velocity section, without the co-brand. */
export function VelocityBrand({compact=false}:{compact?:boolean}){
 if(compact)return <img className="velocity-compact-mark" src="/brand/velocity-official-icon.png" alt="Velocity" width={36} height={36}/>;
 return <span className="velocity-wordmark"><img src="/brand/velocity-official-header.png" alt="Velocity" width={483} height={67}/></span>;
}
