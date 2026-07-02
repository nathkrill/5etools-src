import {CharacterModel} from "./characters-model.js";
import {CharactersFeatEffects} from "./characters-feat-effects.js";
import {CharactersUnarmoredDefense} from "./characters-unarmored-defense.js";

/**
 * Derived-statistics engine for a character object.
 *
 * Pure functions only — no DOM, no async, no rendering. Everything is computed from the
 * serialized character object (plus optionally the resolved class entities for things that
 * depend on class data, e.g. hit dice and spell slots). This keeps the engine easy to unit
 * test and reuse from both the sheet UI and the play features.
 */
export class CharactersCalc {
	/* -------------------------------------------- Abilities -------------------------------------------- */

	/** Final ability score for an ability key ("str".."cha"). */
	static getAbilityScore (character, ab) {
		return character.abilities?.[ab] ?? 10;
	}

	/** Ability modifier for an ability key. */
	static getAbilityModifier (character, ab) {
		return CharacterModel.getAbilityModifier(this.getAbilityScore(character, ab));
	}

	/** Map of ability key -> modifier. */
	static getAbilityModifiers (character) {
		const out = {};
		CharacterModel.ABILITIES.forEach(ab => { out[ab] = this.getAbilityModifier(character, ab); });
		return out;
	}

	static getProficiencyBonus (character) {
		return CharacterModel.getProficiencyBonus(character);
	}

	static getTotalLevel (character) {
		return CharacterModel.getTotalLevel(character);
	}

	/* -------------------------------------------- Saves -------------------------------------------- */

	/** Whether the character is proficient in a given saving throw ability. */
	static isSaveProficient (character, ab) {
		return !!character.proficiencies?.saves?.includes(ab);
	}

	/** Saving throw bonus for an ability. */
	static getSaveBonus (character, ab) {
		const mod = this.getAbilityModifier(character, ab);
		const prof = this.isSaveProficient(character, ab) ? this.getProficiencyBonus(character) : 0;
		return mod + prof;
	}

	static getSaves (character) {
		const out = {};
		CharacterModel.ABILITIES.forEach(ab => {
			out[ab] = {
				bonus: this.getSaveBonus(character, ab),
				isProficient: this.isSaveProficient(character, ab),
			};
		});
		return out;
	}

	/* -------------------------------------------- Skills -------------------------------------------- */

	static isSkillProficient (character, skill) {
		return !!character.proficiencies?.skills?.includes(skill);
	}

	static isSkillExpertise (character, skill) {
		return !!character.proficiencies?.skillsExpertise?.includes(skill);
	}

	/** Skill check bonus, accounting for proficiency and expertise. */
	static getSkillBonus (character, skill) {
		const ab = CharacterModel.SKILL_TO_ABILITY[skill];
		const mod = this.getAbilityModifier(character, ab);
		const pb = this.getProficiencyBonus(character);
		let prof = 0;
		if (this.isSkillExpertise(character, skill)) prof = pb * 2;
		else if (this.isSkillProficient(character, skill)) prof = pb;
		return mod + prof;
	}

	/** Array of `{skill, ability, bonus, isProficient, isExpertise}` sorted alphabetically. */
	static getSkills (character) {
		return Object.keys(CharacterModel.SKILL_TO_ABILITY)
			.sort(SortUtil.ascSortLower)
			.map(skill => ({
				skill,
				ability: CharacterModel.SKILL_TO_ABILITY[skill],
				bonus: this.getSkillBonus(character, skill),
				isProficient: this.isSkillProficient(character, skill),
				isExpertise: this.isSkillExpertise(character, skill),
			}));
	}

	/* -------------------------------------------- Combat -------------------------------------------- */

	/**
	 * Aggregated flat bonuses contributed by the character's feats.
	 * @param feats Optional array of resolved feat entities (with `.name`/`.source`).
	 */
	static getFeatEffects (feats) {
		return CharactersFeatEffects.aggregate(feats || []);
	}

	/**
	 * Initiative bonus = Dex modifier (+ feat bonuses, e.g. Alert).
	 * @param character
	 * @param feats Optional array of resolved feat entities.
	 */
	static getInitiative (character, feats = null) {
		const fx = this.getFeatEffects(feats);
		let bonus = this.getAbilityModifier(character, "dex") + fx.initiative;
		if (fx.initiativeProficiency) bonus += this.getProficiencyBonus(character);
		return bonus;
	}

	static getPassivePerception (character, feats = null) {
		const fx = this.getFeatEffects(feats);
		return 10 + this.getSkillBonus(character, "perception") + fx.passivePerception;
	}

	/**
	 * Armor class. Uses an explicit override if set, otherwise computes from equipped armor and
	 * shields, otherwise an explicit base (+ dex mod), otherwise the best of the unarmored default
	 * (10 + dex mod) and any applicable "Unarmored Defense" class/subclass feature. Feat AC bonuses
	 * are added on top of non-overridden values.
	 *
	 * Per the rules, equipped body armor overrides Unarmored Defense entirely; Unarmored Defense is
	 * only considered while no body armor is equipped.
	 * @param character
	 * @param feats Optional array of resolved feat entities.
	 * @param inventory Optional array of resolved `{entry, item}` inventory objects (from
	 *        `CharactersDataUtil.pGetCharacterInventory`). When provided, equipped armor/shields
	 *        are used to derive the base AC.
	 * @param classInfos Optional array of resolved `[{ref, cls, subclass}]` (from
	 *        `CharactersDataUtil.pGetCharacterClasses`). When provided, "Unarmored Defense"
	 *        class/subclass features are considered while unarmored.
	 */
	static getArmorClass (character, feats = null, inventory = null, classInfos = null) {
		if (character.ac?.override != null) return character.ac.override;
		const fx = this.getFeatEffects(feats);
		const dexMod = this.getAbilityModifier(character, "dex");

		const armorAc = this.getArmorAcFromInventory(inventory, dexMod);

		// Body armor overrides Unarmored Defense entirely (strict RAW).
		if (armorAc != null && armorAc.hasBodyArmor) return armorAc.base + armorAc.shield + fx.ac;

		// No body armor: consider the manual base, the unarmored default, and any Unarmored
		// Defense feature, then take the best. A shield's bonus stacks where the feature allows.
		const shieldBonus = armorAc?.shield || 0;
		const manualOrDefaultBase = character.ac?.base != null ? character.ac.base + dexMod : 10 + dexMod;

		let best = manualOrDefaultBase + shieldBonus;

		const hasShield = shieldBonus > 0;
		const udBase = this.getUnarmoredDefenseAc(character, classInfos, {hasShield, shieldBonus});
		if (udBase != null) best = Math.max(best, udBase);

		return best + fx.ac;
	}

	/**
	 * Best base Armor Class granted by an applicable "Unarmored Defense" class/subclass feature,
	 * or `null` when none applies. Each feature yields `10 + Dex modifier + <secondary ability>
	 * modifier`; where the feature permits it, an equipped shield's bonus is included.
	 *
	 * @param character
	 * @param classInfos Resolved `[{ref, cls, subclass}]`, or null.
	 * @param opts.hasShield Whether a shield is currently equipped.
	 * @param opts.shieldBonus AC bonus from the equipped shield (defaults to 2 when `hasShield`).
	 */
	static getUnarmoredDefenseAc (character, classInfos, {hasShield = false, shieldBonus = null} = {}) {
		const options = CharactersUnarmoredDefense.getOptions(classInfos);
		if (!options.length) return null;

		const dexMod = this.getAbilityModifier(character, "dex");
		const effShieldBonus = shieldBonus != null ? shieldBonus : 2;

		let best = null;
		options.forEach(opt => {
			// Features that require no shield don't apply while a shield is equipped.
			if (hasShield && !opt.allowShield) return;
			let ac = 10 + dexMod + this.getAbilityModifier(character, opt.ability);
			if (hasShield && opt.allowShield) ac += effShieldBonus;
			if (best == null || ac > best) best = ac;
		});

		return best;
	}

	/**
	 * Derive base armor class from a character's equipped armor and shields.
	 *
	 * Returns `{base, shield, hasBodyArmor}` where `base` is the AC contribution from the best
	 * equipped body armor (or `10 + dexMod` when no body armor is equipped but a shield is),
	 * `shield` is the total bonus from equipped shields, and `hasBodyArmor` indicates whether any
	 * body armor is equipped. Returns `null` when nothing relevant is equipped, so the caller can
	 * fall back to the manual/unarmored/Unarmored-Defense values.
	 *
	 * Armor rules:
	 *  - Light armor: `ac + Dex modifier`.
	 *  - Medium armor: `ac + min(Dex modifier, dexterityMax ?? 2)`.
	 *  - Heavy armor: `ac` (no Dex).
	 *  - Shields: `+ac` bonus, stacked on top of armor or the unarmored base.
	 *
	 * @param inventory Array of resolved `{entry, item}` objects, or null.
	 * @param dexMod The character's Dexterity modifier.
	 */
	static getArmorAcFromInventory (inventory, dexMod) {
		if (!inventory || !inventory.length) return null;

		let bestArmor = null;
		let shieldBonus = 0;
		let hasShield = false;

		for (const {entry, item} of inventory) {
			if (!entry?.equipped || !item) continue;
			if (item.ac == null) continue;

			const itemType = item.bardingType || item.type;
			let abv = null;
			try { abv = itemType ? DataUtil.itemType.unpackUid(itemType).abbreviation : null; } catch (e) { abv = null; }

			if (abv === Parser.ITM_TYP_ABV__SHIELD) {
				shieldBonus += item.ac;
				hasShield = true;
				continue;
			}

			let ac;
			if (abv === Parser.ITM_TYP_ABV__HEAVY_ARMOR) {
				ac = item.ac;
			} else if (abv === Parser.ITM_TYP_ABV__MEDIUM_ARMOR) {
				const dexterityMax = item.dexterityMax === undefined ? 2 : item.dexterityMax;
				ac = item.ac + (dexterityMax == null ? dexMod : Math.min(dexMod, dexterityMax));
			} else {
				// Light armor (and anything else that grants Dex without restriction).
				const dexterityMax = item.dexterityMax;
				ac = item.ac + (dexterityMax == null ? dexMod : Math.min(dexMod, dexterityMax));
			}

			if (bestArmor == null || ac > bestArmor) bestArmor = ac;
		}

		if (bestArmor == null && !hasShield) return null;
		return {base: bestArmor == null ? 10 + dexMod : bestArmor, shield: shieldBonus, hasBodyArmor: bestArmor != null};
	}

	/**
	 * Walking speed (+ feat bonuses, e.g. Mobile).
	 * @param character
	 * @param feats Optional array of resolved feat entities.
	 */
	static getSpeed (character, feats = null) {
		const fx = this.getFeatEffects(feats);
		return (character.speed ?? 30) + fx.speed;
	}

	/* -------------------------------------------- HP / Hit Dice -------------------------------------------- */

	/**
	 * Suggested maximum HP from class hit dice + Constitution. Uses the "average" rule
	 * (max at level 1, average rounded up thereafter) across all class levels.
	 * @param character
	 * @param classEntities Map/array of resolved class entities keyed by class ref hash, OR
	 *        a function `(classRef) => classEntity`. Optional; if omitted, hit dice from the
	 *        character's stored `hitDice` are used.
	 */
	static getSuggestedMaxHp (character, classEntities = null, feats = null) {
		const conMod = this.getAbilityModifier(character, "con");
		const dice = this._getHitDiceList(character, classEntities);
		if (!dice.length) return 0;

		let total = 0;
		let isFirst = true;
		dice
			.slice()
			.sort((a, b) => b.faces - a.faces) // biggest die first gets the level-1 max
			.forEach(({faces, count}) => {
				for (let i = 0; i < count; ++i) {
					if (isFirst) {
						total += faces + conMod;
						isFirst = false;
					} else {
						total += Math.floor(faces / 2) + 1 + conMod;
					}
				}
			});

		const fx = this.getFeatEffects(feats);
		const totalLevel = dice.reduce((a, d) => a + d.count, 0);
		total += fx.hpFlat + fx.hpPerLevel * totalLevel;

		return Math.max(totalLevel, total); // never below 1/level
	}

	/** Aggregated hit-dice pools: `[{faces, count}]`. */
	static _getHitDiceList (character, classEntities) {
		const fnGetCls = this._normalizeClassEntityGetter(classEntities);
		if (fnGetCls) {
			const byFaces = {};
			(character.classes || []).forEach(clsRef => {
				const cls = fnGetCls(clsRef);
				const faces = cls?.hd?.faces ?? 8;
				byFaces[faces] = (byFaces[faces] || 0) + (clsRef.level || 0);
			});
			return Object.entries(byFaces).map(([faces, count]) => ({faces: Number(faces), count}));
		}

		// Fall back to stored hit dice (e.g. "d10")
		const byFaces = {};
		(character.hitDice || []).forEach(hd => {
			const faces = Number(String(hd.die || "d8").replace(/^d/, "")) || 8;
			byFaces[faces] = (byFaces[faces] || 0) + (hd.total || 0);
		});
		return Object.entries(byFaces).map(([faces, count]) => ({faces: Number(faces), count}));
	}

	static _normalizeClassEntityGetter (classEntities) {
		if (!classEntities) return null;
		if (typeof classEntities === "function") return classEntities;
		// assume map keyed by hash
		return (clsRef) => classEntities[clsRef.hash] || null;
	}

	/**
	 * Hit-dice pools suitable for the tracker, one entry per die type (e.g. d8, d10),
	 * derived from the character's stored `hitDice`. Falls back to deriving pool sizes from
	 * class entities when `hitDice` is absent/empty.
	 * @return `[{die, faces, total, used}]` sorted by descending faces.
	 */
	static getHitDicePools (character, classEntities = null) {
		const byFaces = {};

		const stored = character.hitDice || [];
		if (stored.length) {
			stored.forEach(hd => {
				const faces = hd.faces ?? (Number(String(hd.die || "d8").replace(/^d/, "")) || 8);
				const cur = byFaces[faces] || (byFaces[faces] = {die: `d${faces}`, faces, total: 0, used: 0});
				cur.total += hd.total || 0;
				cur.used += hd.used || 0;
			});
		} else {
			const fnGetCls = this._normalizeClassEntityGetter(classEntities);
			if (fnGetCls) {
				(character.classes || []).forEach(clsRef => {
					const cls = fnGetCls(clsRef);
					const faces = cls?.hd?.faces ?? 8;
					const cur = byFaces[faces] || (byFaces[faces] = {die: `d${faces}`, faces, total: 0, used: 0});
					cur.total += clsRef.level || 0;
				});
			}
		}

		return Object.values(byFaces)
			.map(p => ({...p, used: Math.min(p.used, p.total)}))
			.sort((a, b) => b.faces - a.faces);
	}

	/**
	 * Number of hit dice regained on a long rest: at least 1, otherwise half total level (rounded down),
	 * per the 5e long-rest rule.
	 */
	static getLongRestHitDiceRecovery (character) {
		const totalLevel = Math.max(1, this.getTotalLevel(character));
		return Math.max(1, Math.floor(totalLevel / 2));
	}

	/* -------------------------------------------- Spellcasting -------------------------------------------- */

	// Standard multiclass spell-slot table; index = effective caster level (1-20).
	static SPELL_SLOTS_BY_LEVEL = [
		[], // 0
		[2],
		[3],
		[4, 2],
		[4, 3],
		[4, 3, 2],
		[4, 3, 3],
		[4, 3, 3, 1],
		[4, 3, 3, 2],
		[4, 3, 3, 3, 1],
		[4, 3, 3, 3, 2],
		[4, 3, 3, 3, 2, 1],
		[4, 3, 3, 3, 2, 1],
		[4, 3, 3, 3, 2, 1, 1],
		[4, 3, 3, 3, 2, 1, 1],
		[4, 3, 3, 3, 2, 1, 1, 1],
		[4, 3, 3, 3, 2, 1, 1, 1],
		[4, 3, 3, 3, 2, 1, 1, 1, 1],
		[4, 3, 3, 3, 3, 1, 1, 1, 1],
		[4, 3, 3, 3, 3, 2, 1, 1, 1],
		[4, 3, 3, 3, 3, 2, 2, 1, 1],
	];

	static CASTER_PROGRESSION_FACTOR = {
		"full": 1,
		"1/2": 0.5,
		"1/3": 1 / 3,
		"artificer": 0.5, // rounds up
		"pact": 0, // warlock uses its own table; handled separately
	};

	/**
	 * Effective caster level for multiclass spell slots.
	 * @param character
	 * @param fnGetCls `(classRef) => classEntity`
	 */
	static getEffectiveCasterLevel (character, fnGetCls) {
		if (!fnGetCls) return 0;
		let levels = 0;
		(character.classes || []).forEach(clsRef => {
			const cls = fnGetCls(clsRef);
			const prog = cls?.casterProgression;
			if (!prog || prog === "pact") return;
			const factor = this.CASTER_PROGRESSION_FACTOR[prog] ?? 0;
			if (!factor) return;
			// Artificer & full casters round levels per multiclass rules; half/third round down except single-class.
			if (factor === 1) levels += (clsRef.level || 0);
			else levels += Math.floor((clsRef.level || 0) * factor + 1e-9);
		});
		return Math.min(20, levels);
	}

	/** Max spell slots per spell level: `{1: n, 2: n, ...}`. Excludes Warlock pact slots (see `getPactMagicSlots`). */
	static getSpellSlotsMax (character, classEntities = null) {
		const fnGetCls = this._normalizeClassEntityGetter(classEntities);
		const lvl = this.getEffectiveCasterLevel(character, fnGetCls);
		const row = this.SPELL_SLOTS_BY_LEVEL[lvl] || [];
		const out = {};
		row.forEach((n, ix) => { if (n) out[ix + 1] = n; });
		return out;
	}

	/**
	 * Warlock Pact Magic slots. These form a *separate* pool from normal spell slots: all pact slots
	 * are the same level and are regained on a short *or* long rest. Sums levels across all classes
	 * whose `casterProgression` is `"pact"` (multiclass warlocks stack pact levels).
	 * @return {?{count: number, level: number}} `null` if the character has no pact-magic levels.
	 */
	static getPactMagicSlots (character, classEntities = null) {
		const fnGetCls = this._normalizeClassEntityGetter(classEntities);
		if (!fnGetCls) return null;

		let pactLevel = 0;
		(character.classes || []).forEach(clsRef => {
			const cls = fnGetCls(clsRef);
			if (cls?.casterProgression === "pact") pactLevel += (clsRef.level || 0);
		});
		if (pactLevel <= 0) return null;

		// Standard 5e Warlock Pact Magic progression (slot count / slot level by warlock level).
		let count;
		if (pactLevel >= 17) count = 4;
		else if (pactLevel >= 11) count = 3;
		else if (pactLevel >= 2) count = 2;
		else count = 1;

		let level;
		if (pactLevel >= 9) level = 5;
		else if (pactLevel >= 7) level = 4;
		else if (pactLevel >= 5) level = 3;
		else if (pactLevel >= 3) level = 2;
		else level = 1;

		return {count, level};
	}

	/** True if the character has any spellcasting class. */
	static isSpellcaster (character, classEntities = null) {
		const fnGetCls = this._normalizeClassEntityGetter(classEntities);
		if (!fnGetCls) return false;
		return (character.classes || []).some(clsRef => {
			const cls = fnGetCls(clsRef);
			return !!cls?.spellcastingAbility;
		});
	}

	/**
	 * Per-class spellcasting summary: `[{className, ability, mod, saveDc, attackBonus, level}]`.
	 * @param character
	 * @param fnGetCls `(classRef) => classEntity`
	 */
	static getSpellcastingInfo (character, fnGetCls) {
		if (!fnGetCls) return [];
		const pb = this.getProficiencyBonus(character);
		return (character.classes || [])
			.map(clsRef => {
				const cls = fnGetCls(clsRef);
				const ability = cls?.spellcastingAbility;
				if (!ability) return null;
				const mod = this.getAbilityModifier(character, ability);
				return {
					className: cls?.name || clsRef._displayName || "Class",
					classSource: cls?.source || clsRef.source,
					ability,
					mod,
					saveDc: 8 + pb + mod,
					attackBonus: pb + mod,
					level: clsRef.level || 0,
				};
			})
			.filter(Boolean);
	}

	/** Highest spell level the character can cast (from their normal + pact slot tables). 0 if none. */
	static getMaxSpellLevel (character, classEntities = null) {
		const slots = this.getSpellSlotsMax(character, classEntities);
		const lvls = Object.keys(slots).map(Number);
		const pact = this.getPactMagicSlots(character, classEntities);
		if (pact) lvls.push(pact.level);
		return lvls.length ? Math.max(...lvls) : 0;
	}

	/**
	 * Per-class spell-selection limits, used to cap how many spells a character may
	 * "know"/"prepare" and how many cantrips they may select.
	 *
	 * Returns one entry per spellcasting class:
	 * `[{className, classSource, level, ability, abilityMod, maxSpellLevel, casterKind,
	 *   cantripsKnown, spellsKnown, preparedCount, isPrepared, label}]`
	 *
	 * `casterKind` is one of:
	 * - `"known"` — Bard, Sorcerer, Ranger, Warlock. The character chooses a fixed-size list of
	 *   spells they *know*; every known spell is always castable. `spellsKnown` is that list size;
	 *   `preparedCount` equals `spellsKnown` (everything known is prepared); `isPrepared` is false.
	 * - `"prepared"` — Cleric, Druid, Paladin, Artificer. The character automatically *knows* their
	 *   entire class spell list and each day *prepares* a limited subset. `preparedCount` is the
	 *   prepare limit (`<$level$> + <$ability_mod$>`-style formula or `preparedSpellsProgression`
	 *   table, min 1); `spellsKnown` is `Infinity` (whole list available); `isPrepared` is true.
	 * - `"spellbook"` — Wizard. The character learns spells into a *spellbook* of bounded size and
	 *   prepares a subset from it. `spellsKnown` is the spellbook size (`spellsKnownProgressionFixed`
	 *   or 6 + 2/level beyond 1st); `preparedCount` is the prepare limit (int mod + level, min 1);
	 *   `isPrepared` is true.
	 *
	 * `cantripsKnown` always derives from the class `cantripProgression` table.
	 */
	static getSpellSelectionLimits (character, fnGetCls) {
		if (!fnGetCls) return [];
		return (character.classes || [])
			.map(clsRef => {
				const cls = fnGetCls(clsRef);
				const ability = cls?.spellcastingAbility;
				if (!ability) return null;

				const level = clsRef.level || 0;
				const ix = Math.max(0, level - 1);
				const abilityMod = this.getAbilityModifier(character, ability);

				const cantripsKnown = Array.isArray(cls.cantripProgression)
					? (cls.cantripProgression[ix] || 0)
					: 0;

				let casterKind = "known";
				let spellsKnown = 0;
				let preparedCount = 0;

				if (Array.isArray(cls.spellsKnownProgression)) {
					// Known caster (Bard, Sorcerer, Ranger, Warlock): fixed list of known spells.
					casterKind = "known";
					spellsKnown = cls.spellsKnownProgression[ix] || 0;
					preparedCount = spellsKnown;
				} else if (Array.isArray(cls.spellsKnownProgressionFixed)) {
					// Spellbook caster (Wizard): grows a spellbook, prepares a subset from it. The fixed
					// progression lists spells *gained per level*, so the spellbook size is the running
					// total of gains up to (and including) the character's current level.
					casterKind = "spellbook";
					spellsKnown = cls.spellsKnownProgressionFixed
						.slice(0, level)
						.reduce((acc, n) => acc + (n || 0), 0);
					preparedCount = Math.max(1, level + abilityMod);
				} else if (Array.isArray(cls.preparedSpellsProgression)) {
					// Prepared caster with an explicit prepared-count table.
					casterKind = "prepared";
					spellsKnown = Infinity;
					preparedCount = cls.preparedSpellsProgression[ix] || 0;
				} else if (cls.preparedSpells != null) {
					// Prepared caster (Cleric, Druid, Paladin, Artificer): knows whole list, prepares a subset.
					casterKind = "prepared";
					spellsKnown = Infinity;
					preparedCount = this._evalPreparedSpellsFormula(cls.preparedSpells, {level, abilityMod});
				} else {
					// Spellcasting class without an explicit known/prepared rule; treat as prepared
					// from the whole class list using the classic formula.
					casterKind = "prepared";
					spellsKnown = Infinity;
					preparedCount = Math.max(1, level + abilityMod);
				}

				const isPrepared = casterKind !== "known";

				return {
					className: cls?.name || clsRef._displayName || "Class",
					classSource: cls?.source || clsRef.source,
					level,
					ability,
					abilityMod,
					maxSpellLevel: this._getClassMaxSpellLevel(cls, level),
					casterKind,
					cantripsKnown,
					spellsKnown,
					preparedCount,
					isPrepared,
					label: isPrepared ? "prepared" : "known",
				};
			})
			.filter(Boolean);
	}

	/** Evaluate a `"<$level$> + <$wis_mod$>"`-style prepared-spells formula (min 1). */
	static _evalPreparedSpellsFormula (formula, {level, abilityMod}) {
		if (typeof formula !== "string") return Math.max(1, level + abilityMod);
		const expr = formula
			.replace(/<\$level\$>/g, `${level}`)
			.replace(/<\$[a-z]{3}_mod\$>/gi, `${abilityMod}`);
		// Only digits, spaces, and + - operators remain; sum them safely (no eval).
		const m = expr.match(/-?\d+/g);
		if (!m) return Math.max(1, level + abilityMod);
		const total = m.reduce((acc, n) => acc + Number(n), 0);
		return Math.max(1, total);
	}

	/** Highest spell level castable by a single class at the given level (from its slot/pact data). */
	static _getClassMaxSpellLevel (cls, level) {
		// Pact (Warlock) progression: highest pact slot level by class level.
		if (cls?.casterProgression === "pact") {
			if (level >= 9) return 5;
			if (level >= 7) return 4;
			if (level >= 5) return 3;
			if (level >= 3) return 2;
			if (level >= 1) return 1;
			return 0;
		}
		const factor = this.CASTER_PROGRESSION_FACTOR[cls?.casterProgression] ?? 0;
		if (!factor) return 0;
		const effLvl = factor === 1 ? level : Math.floor(level * factor + 1e-9);
		const row = this.SPELL_SLOTS_BY_LEVEL[Math.min(20, effLvl)] || [];
		return row.length;
	}

	/* -------------------------------------------- Currency -------------------------------------------- */

	/** Total wealth expressed in gold pieces. */
	static getTotalGold (character) {
		const c = character.currency || {};
		return (c.pp || 0) * 10
			+ (c.gp || 0)
			+ (c.ep || 0) * 0.5
			+ (c.sp || 0) * 0.1
			+ (c.cp || 0) * 0.01;
	}

	/* -------------------------------------------- Formatting -------------------------------------------- */

	/** Format a signed modifier (e.g. 3 => "+3", -1 => "-1"). */
	static fmtBonus (n) {
		return `${n >= 0 ? "+" : "\u2212"}${Math.abs(n)}`;
	}
}

globalThis.CharactersCalc = CharactersCalc;
