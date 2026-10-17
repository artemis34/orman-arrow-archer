/** Extension contract: rules own scoring and match lifecycle, not rendering or transport. */
export class GameMode {
 get id(){throw new Error('Implement id');}
 canDamage(attacker,target){return attacker.id!==target.id;}
 onElimination(_world,_attacker,_target){}
 step(_world,_dt){}
}
export class FreeForAll extends GameMode {get id(){return 'ffa';}}
/** Interface scaffolds only; not advertised as playable modes. */
export class TeamDeathmatch extends GameMode {
 get id(){return 'tdm';}
 canDamage(attacker,target){return attacker.id!==target.id&&attacker.team!==target.team;}
}
export class BattleRoyale extends GameMode {
 constructor(){super();this.radius=42;}
 get id(){return 'br';}
 step(_world,dt){this.radius=Math.max(6,this.radius-dt*.035);}
}
