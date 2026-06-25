/**
 * Curated registry of the mechanical, stat-affecting effects of feats.
 *
 * Feat descriptions are free-form prose, so their numeric effects can't be reliably parsed
 * from text. Instead, the common stat-affecting feats are described here as structured
 * modifiers that the derived-stat engine (`CharactersCalc`) can apply.
 *
 * Only effects that are *flat derived bonuses* belong here (initiative, speed, HP-per-level,
 * AC, passive perception, etc.). Ability-score increases granted by feats are chosen during
 * the build and are already baked into `character.abilities`, so they are intentionally NOT
 * duplicated here (that would double-count them).
 *
 * Keys are `"name|source"` lowercased. A `"name|*"` wildcard key matches a feat of that name
 * from any source (used when the effect is identical across reprints).
 *
 * Effect fields (all optional):
 *   - initiative   {number}  Flat bonus added to initiative.
 *   - speed        {number}  Flat bonus (ft) added to walking speed.
 *   - ac           {number}  Flat bonus added to armor class.
 *   - hpPerLevel   {number}  Flat HP added per character level (e.g. Tough = +2/level).
 *   - hpFlat       {number}  Flat HP added once.
 *   - passivePerception {number}  Flat bonus added to passive Perception.
 *   - initiativeProficiency {boolean}  Add proficiency bonus to initiative.
 */
export class CharactersFeatEffects {
	static REGISTRY = {
		// Alert (2014): +5 initiative.
		"alert|phb": {initiative: 5},
		// Alert (2024): add proficiency bonus to initiative.
		"alert|xphb": {initiativeProficiency: true},

		// Tough: +2 HP per level.
		"tough|phb": {hpPerLevel: 2},
		"tough|xphb": {hpPerLevel: 2},

		// Mobile: +10 ft speed.
		"mobile|phb": {speed: 10},
		"mobile|xphb": {speed: 10},

		// Athlete (half-feat): part of its benefit is a small climb/standing change; no flat
		// derived numeric bonus to the tracked stats, so no entry needed beyond the ASI
		// (handled during build).

		// Observant (2014): +5 passive Perception (and Investigation). 2024 reworks this.
		"observant|phb": {passivePerception: 5},

		// Skulker, Durable, etc. have no flat bonus to the currently-tracked stats.

		// Squat Nimbleness (half-feat): +5 ft speed.
		"squat nimbleness|xge": {speed: 5},
	};

	/** Look up the structured effect for a resolved feat entity, or `null`. */
	static getEffect (feat) {
		if (!feat?.name) return null;
		const name = String(feat.name).toLowerCase();
		const source = String(feat.source || "").toLowerCase();
		return this.REGISTRY[`${name}|${source}`] || this.REGISTRY[`${name}|*`] || null;
	}

	/**
	 * Aggregate the effects of a list of resolved feat entities into a single totals object.
	 * Also returns per-source contributions for UI breakdowns.
	 * @param feats Array of resolved feat entities (with `.name`/`.source`).
	 * @return {{
	 *   initiative: number,
	 *   speed: number,
	 *   ac: number,
	 *   hpPerLevel: number,
	 *   hpFlat: number,
	 *   passivePerception: number,
	 *   initiativeProficiency: boolean,
	 *   sources: Array<{name: string, effect: object}>,
	 * }}
	 */
	static aggregate (feats) {
		const out = {
			initiative: 0,
			speed: 0,
			ac: 0,
			hpPerLevel: 0,
			hpFlat: 0,
			passivePerception: 0,
			initiativeProficiency: false,
			sources: [],
		};
		(feats || []).forEach(feat => {
			const effect = this.getEffect(feat);
			if (!effect) return;
			if (effect.initiative) out.initiative += effect.initiative;
			if (effect.speed) out.speed += effect.speed;
			if (effect.ac) out.ac += effect.ac;
			if (effect.hpPerLevel) out.hpPerLevel += effect.hpPerLevel;
			if (effect.hpFlat) out.hpFlat += effect.hpFlat;
			if (effect.passivePerception) out.passivePerception += effect.passivePerception;
			if (effect.initiativeProficiency) out.initiativeProficiency = true;
			out.sources.push({name: feat.name, effect});
		});
		return out;
	}
}

globalThis.CharactersFeatEffects = CharactersFeatEffects;
