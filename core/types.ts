// 规则内核的共同类型。数据来自 data/*.json，字段含义见 temp/extract/机制.md。
// 凡是文档未定义、已列入 temp/decisions.md 的字段，这里一律可空，禁止私自补默认值。

export type Side = 'first' | 'second';

/** 小回合：先手回合 或 后手回合。一个「大回合」= 先手小回合 + 后手小回合（机制 R08）。 */
export type Phase = Side;

export type Rarity = 'normal' | 'epic' | 'limited' | 'legend' | 'unknown';

export type SkillType =
  | 'battlecry' // 战吼：游戏开始时触发（R04）
  | 'charge' // 充能：回合开始层数 +1（R05）
  | 'cooldown' // CD 类（R16）
  | 'active' // 主动
  | 'passive'
  | 'unknown';

export interface SkillDef {
  name: string;
  type: SkillType;
  /** 原文描述，逐字保留，实现以它为准。 */
  text: string;
  /** 充能层数或耐久消耗，原文未标价时为 null。 */
  cost: number | null;
  durability: number | null;
  cd: number | null;
  /** 双阶段 CD（如玛恩纳「初始CD1、之后CD2」），见 decisions.md Q26。 */
  initialCd: number | null;
}

export interface CharacterDef {
  id: string;
  name: string;
  rarity: Rarity;
  atk: number | null;
  hp: number | null;
  /** BP 选角费用，单位与 14k 预算一致（1k = 1000）。见 decisions.md Q39。 */
  cost: number | null;
  skills: SkillDef[];
}

export interface ItemDef {
  id: string;
  name: string;
  /** 道具花费，单位见 decisions.md Q21。 */
  cost: number | null;
  timing: string;
  text: string;
}

/** 结算来源等级，机制 R21：本角色特性/技能 > 己方道具/技能 > 敌方效果。 */
export type SourceKind = 'self' | 'ally' | 'enemy';

export interface PendingEffect {
  /** 效果标识，便于日志回溯。 */
  id: string;
  /** 受效果影响的角色所在阵营。 */
  targetSide: Side;
  /** 受效果影响的角色站位，1 起。 */
  targetSlot: number;
  source: SourceKind;
  /** 入队顺序，用于同级稳定排序。 */
  seq: number;
}
