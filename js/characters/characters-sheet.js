import {CharacterModel} from "./characters-model.js";
import {CharactersCalc} from "./characters-calc.js";
import {CharactersDataUtil} from "./characters-data.js";
import {CharactersActions} from "./characters-actions.js";

/**
 * Renders a read-only-ish digital character sheet from a character object, using the
 * derived-stats engine ({@link CharactersCalc}) and resolving content references via
 * {@link CharactersDataUtil}. Interactive play features (HP/slot tracking, dice rolls,
 * rest, level-up) are layered on in a later phase; this phase focuses on a faithful,
 * data-driven sheet.
 */
export class CharacterSheet {
	/**
	 * @param opts
	 * @param opts.character The character object.
	 * @param [opts.fnBack] Callback for the "Back to Characters" action.
	 * @param [opts.fnEdit] Callback for the "Edit" action (re-opens the builder).
	 * @param [opts.fnOnChange] Called after a mutation that should be persisted.
	 */
	constructor ({character, fnBack = null, fnEdit = null, fnOnChange = null}) {
		this._character = character;
		this._fnBack = fnBack;
		this._fnEdit = fnEdit;
		this._fnOnChange = fnOnChange;

		this._classInfos = []; // [{ref, cls, subclass}]
		this._race = null; // resolved race entity (or null)
		this._background = null; // resolved background entity (or null)
		this._feats = []; // resolved feat entities
		this._knownSpells = []; // resolved known/prepared spell entities (parallel to character.spells.known)
		this._grantedSpells = []; // spells auto-granted via additionalSpells: [{ref, ent, sourceLabel, kind}]
		this._inventory = []; // [{entry, item}] resolved inventory entries (parallel to character.inventory)
		this._wrp = null;
	}

	/** Render the sheet into the given wrapper element. */
	async pRender (wrp) {
		this._wrp = wrp;
		wrp.empty();

		const ch = this._character;
		[this._classInfos, this._race, this._background, this._feats, this._knownSpells, this._inventory, this._optionalFeatures] = await Promise.all([
			CharactersDataUtil.pGetCharacterClasses(ch),
			ch.race ? CharactersDataUtil.pGetRace(ch.race) : Promise.resolve(null),
			ch.background ? CharactersDataUtil.pGetBackground(ch.background) : Promise.resolve(null),
			Promise.all((ch.feats || []).map(ref => CharactersDataUtil.pGetFeat(ref))).then(arr => arr.filter(Boolean)),
			Promise.all((ch.spells?.known || []).map(ref => CharactersDataUtil.pGetEntity(ref).then(ent => ent ? {ref, ent} : null))).then(arr => arr.filter(Boolean)),
			CharactersDataUtil.pGetCharacterInventory(ch),
			CharactersDataUtil.pGetCharacterOptionalFeatures(ch),
		]);

		// Resolve spells auto-granted via `additionalSpells` (subclass/class/race/feat/invocation). These
		// are surfaced as locked, always-prepared spells in the spell manager and the known-spell list.
		const fnGetClsForGrants = (ref) => (this._classInfos.find(ci => ci.ref.hash === ref.hash)?.cls) || null;
		if (CharactersCalc.isSpellcaster(ch, fnGetClsForGrants)) {
			// Use the selection limits' max spell level (handles Warlock pact magic, which the slot
			// table does not), falling back to the slot-derived level for safety.
			const limits = CharactersCalc.getSpellSelectionLimits(ch, fnGetClsForGrants);
			const maxSpellLevel = limits.reduce((acc, l) => Math.max(acc, l.maxSpellLevel || 0), CharactersCalc.getMaxSpellLevel(ch, fnGetClsForGrants));
			this._grantedSpells = (await CharactersDataUtil.getGrantedSpells(this._classInfos, this._race, this._feats, maxSpellLevel, this._optionalFeatures)).granted;
		} else {
			this._grantedSpells = [];
		}

		ee`<div class="ve-char ve-char-sheet ve-flex-col ve-w-100 ve-px-4 ve-py-3">
			${this._renderHeader()}
			${this._renderTopStats()}
			<div class="ve-char-sheet__cols ve-flex ve-w-100 ve-mt-3">
				<div class="ve-char-sheet__col-left ve-flex-col">
					${this._renderAbilities()}
					${this._renderSaves()}
					${this._renderSkills()}
					${this._renderHitDiceAndRest()}
				</div>
				<div class="ve-char-sheet__col-right ve-flex-col ve-min-w-0">
					${this._renderProficiencies()}
					${this._renderAbilitiesActions()}
					${this._renderSpellcasting()}
					${this._renderInventory()}
					${this._renderFeatures()}
				</div>
			</div>
		</div>`.appendTo(wrp);
	}

	/* -------------------------------------------- Header -------------------------------------------- */

	_renderHeader () {
		const ch = this._character;
		const btnBack = this._fnBack
			? ee`<button class="ve-btn ve-btn-default"><span class="glyphicon glyphicon-chevron-left"></span> Back</button>`
				.onn("click", () => this._fnBack())
			: null;
		const btnEdit = this._fnEdit
			? ee`<button class="ve-btn ve-btn-primary"><span class="glyphicon glyphicon-pencil"></span> Edit</button>`
				.onn("click", () => this._fnEdit())
			: null;

		const classStr = this._classInfos
			.map(({ref, cls, subclass}) => `${cls.name}${subclass ? ` (${subclass.name})` : ""} ${ref.level}`)
			.join(" / ");
		const metaParts = [];
		const totalLevel = CharactersCalc.getTotalLevel(ch);
		if (totalLevel) metaParts.push(`Level ${totalLevel}`);
		if (ch.race?._displayName) metaParts.push(ch.race._displayName);
		if (classStr) metaParts.push(classStr);
		if (ch.background?._displayName) metaParts.push(ch.background._displayName);

		return ee`<div class="ve-char-sheet__header ve-flex-col ve-w-100">
			<div class="ve-split-v-center ve-w-100 ve-mb-2">
				<div class="ve-flex-v-center ve-char__gap-2">${[btnBack].filter(Boolean)}</div>
				<div class="ve-flex-v-center ve-char__gap-2">${[btnEdit].filter(Boolean)}</div>
			</div>
			<h3 class="ve-mt-0 ve-mb-1">${(ch.name || "Character").qq()}</h3>
			<div class="ve-muted">${metaParts.join(" \u2022 ").qq() || "Empty character"}</div>
		</div>`;
	}

	/* -------------------------------------------- Top stats (AC / HP / etc.) -------------------------------------------- */

	_renderTopStats () {
		const ch = this._character;
		const fnGetCls = (ref) => (this._classInfos.find(ci => ci.ref.hash === ref.hash)?.cls) || null;

		const feats = this._feats;
		const fx = CharactersCalc.getFeatEffects(feats);
		const ac = CharactersCalc.getArmorClass(ch, feats, this._inventory);
		const init = CharactersCalc.getInitiative(ch, feats);
		const speed = CharactersCalc.getSpeed(ch, feats);
		const pb = CharactersCalc.getProficiencyBonus(ch);
		const passivePerc = CharactersCalc.getPassivePerception(ch, feats);
		const hpMax = ch.hp?.max || CharactersCalc.getSuggestedMaxHp(ch, fnGetCls, feats);
		const hpCur = ch.hp?.current ?? hpMax;
		const hpTemp = ch.hp?.temp || 0;

		const tile = (label, value, {sub = null, title = null, onClick = null} = {}) => {
			const clazz = onClick ? "ve-char-sheet__tile ve-char-sheet__tile--clickable" : "ve-char-sheet__tile";
			const ele = ee`<div class="${clazz} ve-flex-col ve-flex-vh-center" ${title ? `title="${title.qq()}"` : ""}>
				<div class="ve-char-sheet__tile-val">${value}</div>
				<div class="ve-char-sheet__tile-label ve-muted ve-small">${label.qq()}</div>
				${sub ? ee`<div class="ve-char-sheet__tile-sub ve-muted ve-small">${sub}</div>` : ""}
			</div>`;
			if (onClick) ele.onn("click", onClick);
			return ele;
		};

		// Build per-stat "from feats" tooltips so boosts are explainable.
		const featTitle = (predicate) => {
			const parts = fx.sources
				.filter(src => predicate(src.effect))
				.map(src => src.name);
			return parts.length ? `Includes bonuses from: ${parts.join(", ")}` : null;
		};

		const hpStr = hpTemp ? `${hpCur} + ${hpTemp}` : `${hpCur}`;

		// Note any equipped armor/shields contributing to AC (unless AC is overridden).
		const acArmorTitle = ch.ac?.override != null
			? null
			: (() => {
				const equippedAc = (this._inventory || [])
					.filter(({entry, item}) => entry?.equipped && item && item.ac != null)
					.map(({item}) => item.name);
				return equippedAc.length ? `Includes equipped: ${equippedAc.join(", ")}` : null;
			})();
		const acTitle = [acArmorTitle, featTitle(e => e.ac)].filter(Boolean).join(" \u2022 ") || null;

		return ee`<div class="ve-char-sheet__top ve-flex ve-flex-wrap ve-char__gap-2 ve-mt-3">
			${tile("Armor Class", ac, {title: acTitle})}
			${tile("Initiative", CharactersCalc.fmtBonus(init), {
		title: [featTitle(e => e.initiative || e.initiativeProficiency), "Click to roll"].filter(Boolean).join(" \u2022 "),
		onClick: () => this._pRollD20(init, "Initiative"),
	})}
			${tile("Speed", `${speed} ft.`, {title: featTitle(e => e.speed)})}
			${tile("Prof. Bonus", CharactersCalc.fmtBonus(pb))}
			${tile("Hit Points", hpStr, {
		sub: `/ ${hpMax} max`,
		title: [featTitle(e => e.hpPerLevel || e.hpFlat), "Click to manage HP"].filter(Boolean).join(" \u2022 "),
		onClick: () => this._pOpenHpManager(hpMax),
	})}
			${tile("Passive Perc.", passivePerc, {title: featTitle(e => e.passivePerception)})}
		</div>`;
	}

	/* -------------------------------------------- Abilities -------------------------------------------- */

	_renderAbilities () {
		const ch = this._character;
		const tiles = CharacterModel.ABILITIES.map(ab => {
			const score = CharactersCalc.getAbilityScore(ch, ab);
			const mod = CharactersCalc.getAbilityModifier(ch, ab);
			const btnMod = ee`<button class="ve-char-sheet__ability-mod ve-char-sheet__roll" title="Roll ${CharacterModel.ABILITY_TO_FULL[ab].qq()} check (1d20${UiUtil.intToBonus(mod)})">${CharactersCalc.fmtBonus(mod)}</button>`
				.onn("click", () => this._pRollD20(mod, `${CharacterModel.ABILITY_TO_FULL[ab]} check`));
			return ee`<div class="ve-char-sheet__ability ve-flex-col ve-flex-vh-center">
				<div class="ve-char-sheet__ability-name ve-muted ve-small ve-bold">${ab.toUpperCase()}</div>
				${btnMod}
				<div class="ve-char-sheet__ability-score ve-muted">${score}</div>
			</div>`;
		});
		return ee`<div class="ve-char-sheet__panel">
			<div class="ve-char-sheet__panel-title">Ability Scores</div>
			<div class="ve-char-sheet__abilities ve-flex ve-flex-wrap ve-char__gap-2">${tiles}</div>
		</div>`;
	}

	/* -------------------------------------------- Saves -------------------------------------------- */

	_renderSaves () {
		const ch = this._character;
		const saves = CharactersCalc.getSaves(ch);
		const rows = CharacterModel.ABILITIES.map(ab => {
			const {bonus, isProficient} = saves[ab];
			return ee`<div class="ve-char-sheet__line ve-split-v-center">
				<span class="ve-flex-v-center ve-char__gap-1">
					${this._getProfDot(isProficient)}
					<span>${CharacterModel.ABILITY_TO_FULL[ab]}</span>
				</span>
				${this._getRollBtn(bonus, `${CharacterModel.ABILITY_TO_FULL[ab]} save`)}
			</div>`;
		});
		return ee`<div class="ve-char-sheet__panel">
			<div class="ve-char-sheet__panel-title">Saving Throws</div>
			${rows}
		</div>`;
	}

	/* -------------------------------------------- Skills -------------------------------------------- */

	_renderSkills () {
		const ch = this._character;
		const skills = CharactersCalc.getSkills(ch);
		const rows = skills.map(({skill, ability, bonus, isProficient, isExpertise}) => {
			return ee`<div class="ve-char-sheet__line ve-split-v-center">
				<span class="ve-flex-v-center ve-char__gap-1">
					${this._getProfDot(isProficient, isExpertise)}
					<span>${skill.toTitleCase().qq()}</span>
					<span class="ve-muted ve-small">(${ability.toUpperCase()})</span>
				</span>
				${this._getRollBtn(bonus, `${skill.toTitleCase()} check`)}
			</div>`;
		});
		return ee`<div class="ve-char-sheet__panel">
			<div class="ve-char-sheet__panel-title">Skills</div>
			${rows}
		</div>`;
	}

	_getProfDot (isProficient, isExpertise = false) {
		const cls = isExpertise
			? "ve-char-sheet__prof-dot--expertise"
			: isProficient ? "ve-char-sheet__prof-dot--proficient" : "";
		const title = isExpertise ? "Expertise" : isProficient ? "Proficient" : "Not proficient";
		return ee`<span class="ve-char-sheet__prof-dot ${cls}" title="${title}"></span>`;
	}

	/* -------------------------------------------- Dice rolling -------------------------------------------- */

	/** Roll `1d20 + bonus`, surfacing the result via the shared dice roller. */
	_pRollD20 (bonus, label) {
		return Renderer.dice.pRoll2(
			`1d20${UiUtil.intToBonus(bonus)}`,
			{
				isUser: true,
				name: this._character.name || "Character",
				label,
			},
			{isResultUsed: false},
		);
	}

	/**
	 * Build a clickable, roll-on-click bonus pill.
	 * @param bonus The numeric modifier.
	 * @param label Human-readable label for the roll (e.g. "Athletics check").
	 */
	_getRollBtn (bonus, label) {
		return ee`<button class="ve-char-sheet__roll ve-bold" title="Roll ${label.qq()} (1d20${UiUtil.intToBonus(bonus)})">${CharactersCalc.fmtBonus(bonus)}</button>`
			.onn("click", () => this._pRollD20(bonus, label));
	}

	/* -------------------------------------------- Hit Points -------------------------------------------- */

	/**
	 * Persist the character's HP block (clamping current to `[0, max]`, temp to `>= 0`),
	 * then notify the host and re-render so derived UI updates.
	 */
	_setHp ({current = null, max = null, temp = null} = {}) {
		const ch = this._character;
		ch.hp = ch.hp || {};
		if (max != null) ch.hp.max = Math.max(0, Math.round(max));
		const effMax = ch.hp.max ?? max ?? 0;
		if (current != null) ch.hp.current = Math.max(0, Math.min(effMax || current, Math.round(current)));
		if (temp != null) ch.hp.temp = Math.max(0, Math.round(temp));
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/**
	 * Apply damage, draining temporary HP first (per the 5e rules), then current HP.
	 */
	_applyDamage (amount) {
		const ch = this._character;
		const hp = ch.hp || {};
		let dmg = Math.max(0, Math.round(amount));
		let temp = hp.temp || 0;
		const fromTemp = Math.min(temp, dmg);
		temp -= fromTemp;
		dmg -= fromTemp;
		const current = (hp.current ?? hp.max ?? 0) - dmg;
		return this._setHp({current, temp});
	}

	/** Apply healing, clamped to max HP. */
	_applyHeal (amount) {
		const ch = this._character;
		const hp = ch.hp || {};
		const current = (hp.current ?? hp.max ?? 0) + Math.max(0, Math.round(amount));
		return this._setHp({current});
	}

	/**
	 * Add temporary HP. Temp HP does not stack — keep the larger of existing and incoming.
	 */
	_applyTemp (amount) {
		const ch = this._character;
		const incoming = Math.max(0, Math.round(amount));
		const temp = Math.max(ch.hp?.temp || 0, incoming);
		return this._setHp({temp});
	}

	/** Open a modal for managing HP: damage, heal, temp HP, and direct current/max edits. */
	async _pOpenHpManager (hpMax) {
		const ch = this._character;
		const hp = ch.hp || {};
		const hpCur = hp.current ?? hpMax;
		const hpTemp = hp.temp || 0;

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Manage Hit Points",
			isMinHeight0: true,
			cbClose: () => {},
		});

		const dispCur = ee`<span class="ve-char-sheet__hp-disp-val">${hpCur}</span>`;
		const dispMax = ee`<span>${hpMax}</span>`;
		const dispTemp = ee`<span class="ve-char-sheet__hp-disp-temp">${hpTemp ? `(+${hpTemp} temp)` : ""}</span>`;

		const iptAmount = ee`<input class="form-control ve-char-sheet__hp-ipt" type="number" min="0" value="1" aria-label="Amount">`;
		const getAmt = () => Math.max(0, Math.round(Number(iptAmount.val()) || 0));

		const refreshDisp = () => {
			const h = this._character.hp || {};
			dispCur.txt(`${h.current ?? h.max ?? 0}`);
			dispTemp.txt(h.temp ? `(+${h.temp} temp)` : "");
		};

		const btnDamage = ee`<button class="ve-btn ve-btn-danger">Damage</button>`
			.onn("click", async () => { await this._applyDamage(getAmt()); refreshDisp(); });
		const btnHeal = ee`<button class="ve-btn ve-btn-success">Heal</button>`
			.onn("click", async () => { await this._applyHeal(getAmt()); refreshDisp(); });
		const btnTemp = ee`<button class="ve-btn ve-btn-info">Temp HP</button>`
			.onn("click", async () => { await this._applyTemp(getAmt()); refreshDisp(); });

		const iptSetCur = ee`<input class="form-control ve-char-sheet__hp-ipt" type="number" min="0" value="${hpCur}" aria-label="Set current HP">`;
		const iptSetMax = ee`<input class="form-control ve-char-sheet__hp-ipt" type="number" min="0" value="${hpMax}" aria-label="Set max HP">`;
		const btnSet = ee`<button class="ve-btn ve-btn-default">Set</button>`
			.onn("click", async () => {
				await this._setHp({
					current: Math.round(Number(iptSetCur.val()) || 0),
					max: Math.round(Number(iptSetMax.val()) || 0),
				});
				doClose();
			});

		const btnFull = ee`<button class="ve-btn ve-btn-default">Full Heal</button>`
			.onn("click", async () => { await this._setHp({current: this._character.hp?.max ?? hpMax, temp: 0}); refreshDisp(); });

		ee`<div class="ve-flex-col ve-char__gap-3 ve-p-2">
			<div class="ve-flex-vh-center ve-char__gap-2">
				<span class="ve-char-sheet__hp-disp">${dispCur} / ${dispMax}</span>
				${dispTemp}
			</div>
			<div class="ve-flex-v-center ve-char__gap-2">
				<label class="ve-muted ve-small mb-0">Amount</label>
				${iptAmount}
				${btnDamage}
				${btnHeal}
				${btnTemp}
			</div>
			<hr class="hr-2">
			<div class="ve-flex-v-center ve-char__gap-2 ve-flex-wrap">
				<label class="ve-muted ve-small mb-0">Current</label>
				${iptSetCur}
				<label class="ve-muted ve-small mb-0">Max</label>
				${iptSetMax}
				${btnSet}
				${btnFull}
			</div>
		</div>`.appendTo(eleModalInner);
	}

	/* -------------------------------------------- Hit Dice & Rest -------------------------------------------- */

	/**
	 * Ensure `character.hitDice` is populated (from resolved class hit dice) so that spending
	 * and recovering hit dice can be persisted. Returns the (possibly newly created) pools array
	 * `[{die, faces, total, used}]` as stored on the character.
	 */
	_ensureHitDice () {
		const ch = this._character;
		if (Array.isArray(ch.hitDice) && ch.hitDice.length) return ch.hitDice;

		const fnGetCls = (ref) => (this._classInfos.find(ci => ci.ref.hash === ref.hash)?.cls) || null;
		const pools = CharactersCalc.getHitDicePools(ch, fnGetCls);
		ch.hitDice = pools.map(p => ({die: p.die, faces: p.faces, total: p.total, used: 0}));
		return ch.hitDice;
	}

	/** Render the hit-dice tracker (one pip per die, click to spend/restore) plus Short/Long Rest. */
	_renderHitDiceAndRest () {
		const ch = this._character;
		const pools = this._ensureHitDice();
		if (!pools.length) return "";

		const fnGetCls = (ref) => (this._classInfos.find(ci => ci.ref.hash === ref.hash)?.cls) || null;
		const display = CharactersCalc.getHitDicePools(ch, fnGetCls);

		const rows = display.map(({die, faces, total, used}) => {
			const avail = total - used;
			const pips = [];
			for (let i = 0; i < total; ++i) {
				const isUsed = i < used;
				const pip = ee`<button class="ve-char-sheet__hd-pip ${isUsed ? "ve-char-sheet__hd-pip--used" : ""}" title="${isUsed ? "Spent" : `Spend a ${die.qq()} hit die`} \u2022 click to ${isUsed ? "restore" : "spend"}"></button>`
					.onn("click", () => isUsed ? this._restoreHitDie(faces) : this._pSpendHitDie(faces));
				pips.push(pip);
			}
			return ee`<div class="ve-char-sheet__hd-row ve-flex-v-center ve-char__gap-2">
				<span class="ve-char-sheet__hd-die ve-muted ve-small ve-bold">${die.qq()}</span>
				<span class="ve-flex ve-char__gap-1 ve-flex-wrap">${pips}</span>
				<span class="ve-muted ve-small">${avail}/${total}</span>
			</div>`;
		});

		const btnShort = ee`<button class="ve-btn ve-btn-xs ve-btn-default" title="Spend hit dice to recover HP">Short Rest</button>`
			.onn("click", () => this._pOpenShortRest());
		const btnLong = ee`<button class="ve-btn ve-btn-xs ve-btn-primary" title="Restore HP, spell slots, and some hit dice">Long Rest</button>`
			.onn("click", () => this._pLongRest());

		return ee`<div class="ve-char-sheet__panel">
			<div class="ve-char-sheet__panel-title">Hit Dice &amp; Rest</div>
			${rows}
			<div class="ve-flex-v-center ve-char__gap-2 ve-mt-2">
				${btnShort}
				${btnLong}
			</div>
		</div>`;
	}

	/** Mark one hit die of the given die-type as spent (if any are available). */
	_spendHitDie (faces) {
		const pools = this._ensureHitDice();
		const pool = pools.find(p => p.faces === faces);
		if (!pool || (pool.used || 0) >= pool.total) return false;
		pool.used = (pool.used || 0) + 1;
		return true;
	}

	/** Restore one spent hit die of the given die-type. */
	_restoreHitDie (faces) {
		const pools = this._ensureHitDice();
		const pool = pools.find(p => p.faces === faces);
		if (!pool || !(pool.used > 0)) return;
		pool.used -= 1;
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/**
	 * Spend a single hit die of the given die-type: roll `1d{faces} + CON mod` (min 0 healed per die),
	 * mark the die spent, and apply the healing.
	 */
	async _pSpendHitDie (faces) {
		const ch = this._character;
		if (!this._spendHitDie(faces)) return;

		const conMod = CharactersCalc.getAbilityModifier(ch, "con");
		const roll = await Renderer.dice.pRoll2(
			`1d${faces}${UiUtil.intToBonus(conMod)}`,
			{isUser: true, name: ch.name || "Character", label: `Hit Die (d${faces})`},
			{isResultUsed: true},
		);
		const healed = Math.max(0, Math.round(Number(roll) || 0));
		if (this._fnOnChange) this._fnOnChange();
		return this._applyHeal(healed);
	}

	/** Open a Short Rest helper modal: spend any available hit dice one at a time to recover HP. */
	async _pOpenShortRest () {
		const ch = this._character;

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Short Rest",
			isMinHeight0: true,
			cbClose: () => {},
		});

		const wrpBody = ee`<div class="ve-flex-col ve-char__gap-3 ve-p-2"></div>`;

		const dispHp = ee`<span class="ve-char-sheet__hp-disp-val"></span>`;
		const refreshHp = () => dispHp.txt(`${this._character.hp?.current ?? this._character.hp?.max ?? 0}`);

		const renderRows = () => {
			const fnGetCls = (ref) => (this._classInfos.find(ci => ci.ref.hash === ref.hash)?.cls) || null;
			const display = CharactersCalc.getHitDicePools(this._character, fnGetCls);
			refreshHp();

			const rows = display.map(({die, faces, total, used}) => {
				const avail = total - used;
				const btn = ee`<button class="ve-btn ve-btn-sm ve-btn-success" ${avail > 0 ? "" : "disabled"}>Spend ${die.qq()}</button>`
					.onn("click", async () => {
						await this._pSpendHitDie(faces);
						renderRows();
					});
				return ee`<div class="ve-flex-v-center ve-split-v-center ve-char__gap-3">
					<span><span class="ve-bold">${die.qq()}</span> <span class="ve-muted ve-small">${avail}/${total} available</span></span>
					${btn}
				</div>`;
			});

			ee`<div class="ve-flex-col ve-char__gap-2">
				<div class="ve-flex-vh-center ve-char__gap-2 ve-mb-1">
					<span class="ve-muted ve-small">Current HP</span>
					<span class="ve-char-sheet__hp-disp">${dispHp}</span>
				</div>
				${rows.length ? rows : ee`<div class="ve-muted ve-italic">No hit dice available.</div>`}
				<div class="ve-muted ve-small ve-mt-1">Spending a hit die rolls it + your CON modifier and heals that much.</div>
			</div>`.appendTo(wrpBody.empty());
		};

		renderRows();

		const btnDone = ee`<button class="ve-btn ve-btn-default ve-mt-2">Done</button>`
			.onn("click", () => {
				// Recover short-rest abilities and Pact Magic slots on completing the rest.
				const didResetAbilities = this._resetAbilityUses([CharactersActions.RESET_SHORT]);
				const hadPactUsed = (this._character.spells?.pact?.used || 0) > 0;
				this._restorePactSlots();
				if (didResetAbilities || hadPactUsed) {
					if (this._fnOnChange) this._fnOnChange();
					doClose();
					return this.pRender(this._wrp);
				}
				doClose();
			});

		ee`<div class="ve-flex-col">
			${wrpBody}
			<div class="ve-flex-h-right">${btnDone}</div>
		</div>`.appendTo(eleModalInner);
	}

	/**
	 * Take a long rest: restore HP to max, clear temp HP, restore all spell slots, and recover
	 * hit dice (at least 1, otherwise half total level). Mutates and persists.
	 */
	async _pLongRest () {
		const ch = this._character;
		const fnGetCls = (ref) => (this._classInfos.find(ci => ci.ref.hash === ref.hash)?.cls) || null;
		const hpMax = ch.hp?.max || CharactersCalc.getSuggestedMaxHp(ch, fnGetCls, this._feats);

		const isConfirmed = await InputUiUtil.pGetUserBoolean({
			title: "Long Rest",
			htmlDescription: `<div>Take a long rest? This restores HP to <b>${hpMax}</b>, clears temporary HP, restores all spell slots, and recovers <b>${CharactersCalc.getLongRestHitDiceRecovery(ch)}</b> hit dice.</div>`,
			textYes: "Long Rest",
			textNo: "Cancel",
		});
		if (!isConfirmed) return;

		// HP
		ch.hp = ch.hp || {};
		ch.hp.max = hpMax;
		ch.hp.current = hpMax;
		ch.hp.temp = 0;

		// Spell slots (including Pact Magic)
		Object.values(ch.spells?.slots || {}).forEach(slot => { slot.used = 0; });
		this._restorePactSlots();

		// Limited-use abilities — a long rest also satisfies anything that recovers on a short rest.
		this._resetAbilityUses([CharactersActions.RESET_SHORT, CharactersActions.RESET_LONG]);

		// Hit dice — recover up to `recovery` spent dice, preferring larger dice first.
		const pools = this._ensureHitDice();
		let recovery = CharactersCalc.getLongRestHitDiceRecovery(ch);
		pools
			.slice()
			.sort((a, b) => b.faces - a.faces)
			.forEach(pool => {
				while (recovery > 0 && (pool.used || 0) > 0) {
					pool.used -= 1;
					recovery -= 1;
				}
			});

		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/**
	 * Reset the "used" count to 0 for every tracked ability whose `resetOn` is in `resetKinds`.
	 * @return {boolean} Whether any record was actually changed.
	 */
	_resetAbilityUses (resetKinds) {
		const ch = this._character;
		const kinds = new Set(resetKinds);
		let changed = false;
		Object.values(ch.abilityUses || {}).forEach(rec => {
			if (!rec || !kinds.has(rec.resetOn)) return;
			if ((rec.used || 0) === 0) return;
			rec.used = 0;
			changed = true;
		});
		return changed;
	}

	/* -------------------------------------------- Inventory -------------------------------------------- */

	/** Key used to de-duplicate / find inventory lines by their referenced item. */
	static _invKeyOf (ref) { return `${ref.page}|${ref.source}|${ref.hash}`; }

	/**
	 * Render the inventory panel: a currency strip, a list of carried items (name link with hover,
	 * quantity steppers, equip/attune toggles, remove), a total-weight readout, and an "Add Item"
	 * action. Each name uses an `{@item}` link so the usual hover popup works.
	 */
	_renderInventory () {
		const ch = this._character;
		ch.inventory = ch.inventory || [];
		ch.currency = ch.currency || {pp: 0, gp: 0, ep: 0, sp: 0, cp: 0};

		const btnAdd = ee`<button class="ve-btn ve-btn-xs ve-btn-primary" title="Add an item to this character's inventory">Add Item</button>`
			.onn("click", () => this._pOpenItemManager());

		const wrpRows = ee`<div class="ve-char-sheet__inv-rows ve-flex-col"></div>`;
		const renderer = Renderer.get();

		const resolved = this._inventory || [];
		if (!resolved.length) {
			ee`<div class="ve-muted ve-italic ve-small ve-py-2">No items yet. Use "Add Item".</div>`.appendTo(wrpRows);
		}

		let totalWeight = 0;

		resolved.forEach(({entry, item}) => {
			const qty = Math.max(1, Number(entry.quantity) || 1);
			const isCustom = !!entry.custom;
			let name;
			if (isCustom) {
				const customName = ee`<span class="ve-char-sheet__inv-name-custom ve-bold help-subtle" ${entry.description ? `title="${entry.description.qq()}"` : ""}>${(entry.name || "Custom item").qq()}</span>`;
				name = customName;
			} else if (item) {
				name = renderer.render(`{@item ${item.name}|${item.source}}`);
			} else {
				name = `<span class="ve-muted ve-italic">Unknown item</span>`;
			}

			const weightEach = isCustom ? (Number(entry.weight) || 0) : (item ? (Number(item.weight) || 0) : 0);
			if (weightEach) totalWeight += weightEach * qty;
			const weightStr = weightEach ? `${weightEach * qty} lb.` : "";

			// Quantity stepper.
			const dispQty = ee`<span class="ve-char-sheet__inv-qty-val ve-bold">${qty}</span>`;
			const btnDec = ee`<button class="ve-btn ve-btn-xxs ve-btn-default" title="Decrease quantity">\u2212</button>`
				.onn("click", () => this._adjustItemQty(entry, -1));
			const btnInc = ee`<button class="ve-btn ve-btn-xxs ve-btn-default" title="Increase quantity">+</button>`
				.onn("click", () => this._adjustItemQty(entry, 1));

			// Equip / attune toggles (only meaningful for resolvable items, but harmless otherwise).
			const canAttune = item ? !!item.reqAttune : false;
			const btnEquip = ee`<button class="ve-char-sheet__inv-flag ve-btn ve-btn-xxs ${entry.equipped ? "ve-btn-primary" : "ve-btn-default"}" title="${entry.equipped ? "Equipped" : "Not equipped"} \u2022 click to toggle">E</button>`
				.onn("click", () => this._toggleItemFlag(entry, "equipped"));
			const btnAttune = canAttune
				? ee`<button class="ve-char-sheet__inv-flag ve-btn ve-btn-xxs ${entry.attuned ? "ve-btn-primary" : "ve-btn-default"}" title="${entry.attuned ? "Attuned" : "Not attuned"} \u2022 click to toggle">A</button>`
					.onn("click", () => this._toggleItemFlag(entry, "attuned"))
				: null;

			const btnRemove = ee`<button class="ve-char-sheet__inv-remove ve-btn ve-btn-xxs ve-btn-danger" title="Remove from inventory"><span class="glyphicon glyphicon-trash"></span></button>`
				.onn("click", () => this._removeItem(entry));

			ee`<div class="ve-char-sheet__inv-row ve-flex-v-center ve-w-100 ve-char__gap-2">
				<span class="ve-char-sheet__inv-name ve-flex-1 ve-min-w-0">${name}</span>
				<span class="ve-char-sheet__inv-weight ve-muted ve-small">${weightStr.qq()}</span>
				<span class="ve-char-sheet__inv-qty ve-flex-v-center ve-char__gap-1">${btnDec}${dispQty}${btnInc}</span>
				<span class="ve-flex-v-center ve-char__gap-1">${[btnEquip, btnAttune].filter(Boolean)}</span>
				${btnRemove}
			</div>`.appendTo(wrpRows);
		});

		const wrpCurrency = this._renderCurrency();

		const footParts = [];
		if (totalWeight) footParts.push(`Total weight ${Number(totalWeight.toFixed(2))} lb.`);
		const foot = footParts.length
			? ee`<div class="ve-char-sheet__inv-foot ve-muted ve-small ve-mt-2">${footParts.join(" \u2022 ").qq()}</div>`
			: "";

		return ee`<div class="ve-char-sheet__panel ve-char-sheet__inventory">
			<div class="ve-split-v-center">
				<div class="ve-char-sheet__panel-title ve-mb-0 ve-no-border">Inventory</div>
				${btnAdd}
			</div>
			${wrpCurrency}
			${wrpRows}
			${foot}
		</div>`;
	}

	/** Render the editable currency strip (pp / gp / ep / sp / cp number inputs). */
	_renderCurrency () {
		const ch = this._character;
		const coins = [
			{key: "pp", label: "PP"},
			{key: "gp", label: "GP"},
			{key: "ep", label: "EP"},
			{key: "sp", label: "SP"},
			{key: "cp", label: "CP"},
		];

		const cells = coins.map(({key, label}) => {
			const input = ee`<input class="ve-char-sheet__coin-input form-control input-xs ve-text-right" type="number" min="0" step="1" value="${Math.max(0, Number(ch.currency[key]) || 0)}">`
				.onn("change", () => {
					ch.currency[key] = Math.max(0, Math.floor(Number(input.val()) || 0));
					if (this._fnOnChange) this._fnOnChange();
				});
			return ee`<label class="ve-char-sheet__coin ve-flex-v-center ve-char__gap-1">
				<span class="ve-char-sheet__coin-lbl ve-muted ve-small ve-bold">${label}</span>
				${input}
			</label>`;
		});

		return ee`<div class="ve-char-sheet__currency ve-flex ve-flex-wrap ve-char__gap-2 ve-mb-2">${cells}</div>`;
	}

	/** Add 1 to / subtract 1 from an inventory line's quantity (removing it at 0). */
	_adjustItemQty (entry, delta) {
		const ch = this._character;
		const next = (Number(entry.quantity) || 1) + delta;
		if (next <= 0) return this._removeItem(entry);
		entry.quantity = next;
		ch.inventory = ch.inventory || [];
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/** Toggle a boolean flag ("equipped" / "attuned") on an inventory line. */
	_toggleItemFlag (entry, flag) {
		entry[flag] = !entry[flag];
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/** Remove an inventory line entirely. */
	_removeItem (entry) {
		const ch = this._character;
		ch.inventory = (ch.inventory || []).filter(it => it !== entry);
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/**
	 * Open the add-item modal: a searchable, scrollable item list on the left and a live preview
	 * pane on the right (rendered inside the modal). Clicking an item adds one to inventory
	 * (incrementing the quantity if already carried) and updates the sheet behind the modal.
	 */
	async _pOpenItemManager () {
		const ch = this._character;
		ch.inventory = ch.inventory || [];

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Add Item",
			isWidth100: true,
			isHeight100: true,
			isUncappedHeight: true,
			cbClose: () => {},
		});

		const allItems = await CharactersDataUtil.pLoadItems();

		// Right-hand preview pane (inside the modal to avoid hover z-index issues).
		const wrpPreview = ee`<div class="ve-char-sheet__inv-preview ve-overflow-y-auto"></div>`;
		const clearPreview = () => wrpPreview.html(`<div class="ve-muted ve-italic ve-p-3 ve-text-center">Hover or click <span class="glyphicon glyphicon-info-sign"></span> on an item to preview it here.</div>`);
		clearPreview();
		const showPreview = (item) => {
			wrpPreview.empty();
			ee`<table class="w-100 stats">${Renderer.item.getCompactRenderedString(item)}</table>`.appendTo(wrpPreview);
		};

		// Left-hand list (search + rows).
		const wrpRows = ee`<div class="ve-char-sheet__inv-picker-rows ve-flex-col ve-overflow-y-auto"></div>`;

		const typeNameOf = (item) => (item.type ? (Renderer.item.getType(item.type, {isIgnoreMissing: true})?.name || "") : "");

		const fnMatches = (item, terms) => {
			if (!terms.length) return true;
			const hay = `${item.name} ${Parser.sourceJsonToAbv(item.source)} ${typeNameOf(item)}`.toLowerCase();
			return terms.every(t => hay.includes(t));
		};

		const MAX_SHOWN = 250;
		const renderRows = (query) => {
			wrpRows.empty();
			const terms = (query || "").toLowerCase().split(/\s+/g).filter(Boolean);
			const matched = allItems.filter(item => fnMatches(item, terms));
			const shown = matched.slice(0, MAX_SHOWN);

			shown.forEach(item => {
				const ref = CharactersDataUtil.getItemRef(item);
				const k = CharacterSheet._invKeyOf(ref);
				const owned = ch.inventory.find(e => CharacterSheet._invKeyOf(e) === k);

				const meta = [typeNameOf(item), Parser.itemValueToFull(item), Parser.itemWeightToFull(item)]
					.filter(Boolean)
					.join(" \u2022 ");

				const btnInfo = ee`<button class="ve-btn ve-btn-xxs ve-btn-default" title="Preview ${item.name.qq()}"><span class="glyphicon glyphicon-info-sign"></span></button>`
					.onn("click", (evt) => { evt.stopPropagation(); showPreview(item); })
					.onn("mouseover", () => showPreview(item));

				const btnAdd = ee`<button class="ve-btn ve-btn-xxs ve-btn-primary" title="Add to inventory">${owned ? `Add (${owned.quantity || 1})` : "Add"}</button>`
					.onn("click", (evt) => {
						evt.stopPropagation();
						this._addItemRef(ref);
						const cur = ch.inventory.find(e => CharacterSheet._invKeyOf(e) === k);
						btnAdd.txt(`Add (${cur?.quantity || 1})`);
					});

				ee`<div class="ve-char-sheet__inv-picker-row ve-flex-v-center ve-w-100 ve-char__gap-2" title="${item.name.qq()}">
					<span class="ve-flex-1 ve-min-w-0">
						<span class="ve-char-sheet__inv-picker-name ve-bold">${item.name.qq()}</span>
						<span class="ve-muted ve-small ve-ml-2">${meta.qq()}</span>
					</span>
					${btnInfo}
					${btnAdd}
				</div>`
					.onn("mouseover", () => showPreview(item))
					.appendTo(wrpRows);
			});

			if (matched.length > shown.length) {
				ee`<div class="ve-muted ve-italic ve-small ve-py-2 ve-text-center">Showing first ${shown.length} of ${matched.length} \u2014 refine your search.</div>`.appendTo(wrpRows);
			}
			if (!matched.length) {
				ee`<div class="ve-muted ve-italic ve-py-2 ve-text-center">No items match "${(query || "").qq()}".</div>`.appendTo(wrpRows);
			}
		};

		const iptSearch = ee`<input class="form-control input-sm" type="search" placeholder="Search items by name, type, or source\u2026">`
			.onn("keyup", () => renderRows(iptSearch.val()))
			.onn("search", () => renderRows(iptSearch.val()));

		const btnDone = ee`<button class="ve-btn ve-btn-default">Done</button>`
			.onn("click", () => doClose());

		// Custom-item form (collapsible). Lets the user add an item that isn't in the data set.
		const wrpCustom = this._renderCustomItemForm({showPreview, clearPreview});
		const btnToggleCustom = ee`<button class="ve-btn ve-btn-sm ve-btn-default" title="Add an item that isn't in the list"><span class="glyphicon glyphicon-plus"></span> Custom Item</button>`
			.onn("click", () => {
				const isHidden = wrpCustom.hasClass("ve-hidden");
				wrpCustom.toggleVe(isHidden);
				btnToggleCustom.toggleClass("active", isHidden);
			});

		ee`<div class="ve-char-sheet__inv-manager ve-flex-col ve-h-100 ve-w-100">
			<div class="ve-flex ve-char__gap-2 ve-mb-2">${iptSearch}${btnToggleCustom}${btnDone}</div>
			${wrpCustom}
			<div class="ve-char-sheet__inv-panes ve-flex ve-char__gap-3 ve-min-h-0 ve-flex-1">
				<div class="ve-char-sheet__inv-picker ve-flex-col ve-flex-1 ve-min-w-0">${wrpRows}</div>
				${wrpPreview}
			</div>
		</div>`.appendTo(eleModalInner);

		renderRows("");
	}

	/**
	 * Render the (initially hidden) custom-item form used inside the Add Item modal. Provides a
	 * name field (required) and a description field, plus optional quantity/weight, and an "Add"
	 * button that pushes a custom inventory line and re-renders the sheet behind the modal.
	 */
	_renderCustomItemForm ({showPreview} = {}) {
		const iptName = ee`<input class="form-control input-sm" type="text" placeholder="Item name (required)">`;
		const iptDesc = ee`<textarea class="form-control input-sm ve-char-sheet__inv-custom-desc" rows="3" placeholder="Description (optional)"></textarea>`;
		const iptQty = ee`<input class="form-control input-sm ve-text-right" type="number" min="1" step="1" value="1">`;
		const iptWeight = ee`<input class="form-control input-sm ve-text-right" type="number" min="0" step="0.1" placeholder="0">`;
		const wrpErr = ee`<div class="ve-char-sheet__inv-custom-err ve-text-danger ve-small ve-mt-1 ve-hidden"></div>`;

		const btnAddCustom = ee`<button class="ve-btn ve-btn-sm ve-btn-primary">Add Custom Item</button>`
			.onn("click", () => {
				const name = (iptName.val() || "").trim();
				if (!name) {
					wrpErr.txt("Please enter an item name.").showVe();
					return;
				}
				wrpErr.hideVe();
				const description = (iptDesc.val() || "").trim();
				const quantity = Math.max(1, Math.floor(Number(iptQty.val()) || 1));
				const weight = Math.max(0, Number(iptWeight.val()) || 0);
				this._addCustomItem({name, description, quantity, weight});
				// Reset the form for the next entry.
				iptName.val("");
				iptDesc.val("");
				iptQty.val("1");
				iptWeight.val("");
				if (showPreview) {
					// Preview the just-added custom item.
					showPreview({name, source: "Homebrew", type: null, weight, entries: description ? [description] : [], _isCustom: true});
				}
				iptName.focus();
			});

		return ee`<div class="ve-char-sheet__inv-custom ve-mb-2 ve-p-2 ve-hidden">
			<div class="ve-char-sheet__inv-custom-title ve-bold ve-small ve-mb-2">Add a custom item</div>
			<div class="ve-flex-col ve-char__gap-2">
				<label class="ve-flex-col ve-char__gap-1">
					<span class="ve-muted ve-small">Name</span>
					${iptName}
				</label>
				<label class="ve-flex-col ve-char__gap-1">
					<span class="ve-muted ve-small">Description</span>
					${iptDesc}
				</label>
				<div class="ve-flex ve-char__gap-3">
					<label class="ve-flex-col ve-char__gap-1">
						<span class="ve-muted ve-small">Quantity</span>
						${iptQty}
					</label>
					<label class="ve-flex-col ve-char__gap-1">
						<span class="ve-muted ve-small">Weight (lb. each)</span>
						${iptWeight}
					</label>
				</div>
			</div>
			${wrpErr}
			<div class="ve-flex ve-mt-2">${btnAddCustom}</div>
		</div>`;
	}

	/** Push a custom (non-data) item line onto the inventory and re-render the sheet. */
	_addCustomItem ({name, description, quantity = 1, weight = 0}) {
		const ch = this._character;
		ch.inventory = ch.inventory || [];
		ch.inventory.push({
			custom: true,
			name,
			description: description || "",
			weight: Math.max(0, Number(weight) || 0),
			quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
			equipped: false,
			attuned: false,
		});
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/** Add one of an item (by ref) to the inventory, incrementing quantity if already present. */
	_addItemRef (ref) {
		const ch = this._character;
		ch.inventory = ch.inventory || [];
		const k = CharacterSheet._invKeyOf(ref);
		const existing = ch.inventory.find(e => CharacterSheet._invKeyOf(e) === k);
		if (existing) {
			existing.quantity = (Number(existing.quantity) || 1) + 1;
		} else {
			ch.inventory.push({page: ref.page, source: ref.source, hash: ref.hash, quantity: 1, equipped: false, attuned: false});
		}
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/* -------------------------------------------- Spell selection -------------------------------------------- */

	/**
	 * Open the spell-selection modal. Two-pane layout: a scrollable spell list on the left and a
	 * live preview pane on the right (rendered *inside* the modal so it is never hidden behind it).
	 *
	 * Selection respects the known-vs-prepared rules of each caster:
	 * - "known" casters (Bard, Sorcerer, Ranger, Warlock) pick a fixed-size list of known spells;
	 *   every known spell is castable, so there is a single toggle per spell.
	 * - "prepared" casters (Cleric, Druid, Paladin, Artificer) know their whole class list and
	 *   prepare a limited subset — only a "Prepared" toggle is shown (the known pool is unlimited).
	 * - "spellbook" casters (Wizard) learn spells into a bounded spellbook and prepare a subset
	 *   from it — two toggles per spell ("In Book" and "Prepared", the latter requiring the former).
	 *
	 * Cantrips are always "known" (no prepare step) and capped by the combined cantrip budget.
	 */
	async _pOpenSpellManager (limits) {
		const ch = this._character;

		// Aggregate caps across (multi)class.
		const totalCantrips = limits.reduce((acc, l) => acc + (l.cantripsKnown || 0), 0);
		const hasPrepared = limits.some(l => l.isPrepared);
		const hasSpellbook = limits.some(l => l.casterKind === "spellbook");
		// "Known pool" cap: finite for known/spellbook casters; unlimited if any class is a prepared caster.
		const knownPoolUnlimited = limits.some(l => l.casterKind === "prepared");
		const totalKnownPool = knownPoolUnlimited
			? Infinity
			: limits.reduce((acc, l) => acc + (Number.isFinite(l.spellsKnown) ? l.spellsKnown : 0), 0);
		const totalPrepared = limits.reduce((acc, l) => acc + (l.preparedCount || 0), 0);

		// Whether the leveled-spell list has a distinct "prepared" step beyond simply knowing it.
		const usesPrepareStep = hasPrepared;
		// Whether there is a known/in-book pool that is itself limited (spellbook or pure-known caster).
		const usesKnownPool = !knownPoolUnlimited;

		const maxSpellLevel = limits.reduce((acc, l) => Math.max(acc, l.maxSpellLevel || 0), 0);

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Manage Spells",
			isWidth100: true,
			isHeight100: true,
			isUncappedHeight: true,
			cbClose: () => {},
		});

		// Working selection: key => {ref, level, known, prepared}.
		ch.spells = ch.spells || {};
		ch.spells.known = ch.spells.known || [];
		const keyOf = (ref) => `${ref.page}|${ref.source}|${ref.hash}`;
		const selected = new Map();
		ch.spells.known.forEach(s => {
			selected.set(keyOf(s), {
				ref: {page: s.page, source: s.source, hash: s.hash},
				level: s._level ?? null,
				known: true,
				prepared: s.prepared !== false, // default true for back-compat
			});
		});

		const {byLevel, refOf} = await CharactersDataUtil.pGetCharacterSpellList(this._classInfos, maxSpellLevel);

		// Pull spells granted/expanded via `additionalSpells` (subclass/class/race/feat).
		//  - `granted` spells are auto-known & always-prepared: shown locked, can't be toggled off.
		//  - `expanded` spells are added to the *selectable* list (e.g. Warlock patron expanded lists).
		const optionalFeatures = await CharactersDataUtil.pGetCharacterOptionalFeatures(ch);
		const {granted: grantedSpells, expanded: expandedSpells} = await CharactersDataUtil.getGrantedSpells(this._classInfos, this._race, this._feats, maxSpellLevel, optionalFeatures);
		const grantedKeys = new Set(grantedSpells.map(g => keyOf(g.ref)));

		// Drop any granted spells that were previously persisted into the manual selection so they
		// don't double-count or get re-saved as manual choices.
		grantedKeys.forEach(k => selected.delete(k));

		// Merge expanded spells into the selectable list, avoiding duplicates already on the class list.
		const seenSelectable = new Set();
		Object.values(byLevel).forEach(arr => arr.forEach(sp => seenSelectable.add(`${sp.source}|${sp.name}`.toLowerCase())));
		expandedSpells.forEach(sp => {
			const dedupeKey = `${sp.source}|${sp.name}`.toLowerCase();
			if (seenSelectable.has(dedupeKey)) return;
			if (grantedKeys.has(keyOf(refOf(sp)))) return; // already granted outright
			seenSelectable.add(dedupeKey);
			(byLevel[sp.level] = byLevel[sp.level] || []).push(sp);
		});
		Object.values(byLevel).forEach(arr => arr.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source)));

		// Backfill spell levels onto pre-seeded selections (stored refs carry no level), so counts
		// are correct before any toggle interaction.
		Object.entries(byLevel).forEach(([lvl, spells]) => {
			spells.forEach(sp => {
				const s = selected.get(keyOf(refOf(sp)));
				if (s && s.level == null) s.level = Number(lvl);
			});
		});

		// Count helpers.
		const counts = () => {
			let cantrips = 0; let known = 0; let prepared = 0;
			selected.forEach(s => {
				if (s.level === 0) cantrips++;
				else {
					if (s.known) known++;
					if (s.prepared) prepared++;
				}
			});
			return {cantrips, known, prepared};
		};

		// Header readouts.
		const hdrCantrips = ee`<span class="ve-bold"></span>`;
		const hdrKnown = ee`<span class="ve-bold"></span>`;
		const hdrPrepared = ee`<span class="ve-bold"></span>`;

		const rowRefreshers = [];
		const updateHeader = () => {
			const c = counts();
			hdrCantrips.txt(`Cantrips ${c.cantrips}/${totalCantrips}`);
			if (usesKnownPool) {
				const cap = Number.isFinite(totalKnownPool) ? totalKnownPool : "\u221e";
				hdrKnown.txt(`${hasSpellbook ? "Spellbook" : "Known"} ${c.known}/${cap}`);
				hdrKnown.toggleVe(true);
			} else {
				hdrKnown.toggleVe(false);
			}
			if (usesPrepareStep) {
				hdrPrepared.txt(`Prepared ${c.prepared}/${totalPrepared}`);
				hdrPrepared.toggleVe(true);
			} else {
				hdrPrepared.toggleVe(false);
			}
			return c;
		};

		const refreshAll = () => {
			updateHeader();
			rowRefreshers.forEach(fn => fn());
		};

		// Right-hand preview pane (rendered inside the modal — avoids the hover-window z-index issue).
		const wrpPreview = ee`<div class="ve-char-sheet__spell-preview ve-overflow-y-auto"></div>`;
		const clearPreview = () => wrpPreview.html(`<div class="ve-muted ve-italic ve-p-3 ve-text-center">Hover or click <span class="glyphicon glyphicon-info-sign"></span> on a spell to preview it here.</div>`);
		clearPreview();
		const showPreview = (sp) => {
			wrpPreview.empty();
			ee`<table class="w-100 stats">${Renderer.spell.getCompactRenderedString(sp)}</table>`.appendTo(wrpPreview);
		};

		// Left-hand list.
		const wrpLevels = ee`<div class="ve-char-sheet__spell-picker ve-flex-col ve-char__gap-3 ve-py-2"></div>`;

		// Granted spells (always-prepared, locked) — shown first, not toggleable, not counted vs caps.
		if (grantedSpells.length) {
			const wrpGrantedRows = ee`<div class="ve-flex-col"></div>`;
			grantedSpells
				.slice()
				.sort((a, b) => (a.ent.level - b.ent.level) || SortUtil.ascSortLower(a.ent.name, b.ent.name))
				.forEach(g => {
					const sp = g.ent;
					const lvlLabel = sp.level === 0 ? "Cantrip" : `Lvl ${sp.level}`;
					const btnInfo = ee`<button class="ve-char-sheet__spell-info ve-btn ve-btn-xxs ve-btn-default" title="Preview ${sp.name.qq()}"><span class="glyphicon glyphicon-info-sign"></span></button>`
						.onn("click", () => showPreview(sp))
						.onn("mouseover", () => showPreview(sp));
					ee`<div class="ve-char-sheet__spell-row ve-char-sheet__spell-row--on ve-flex-v-center ve-char__gap-2">
						<span class="ve-char-sheet__spell-toggle ve-char-sheet__spell-toggle--on" title="Granted spell (always prepared)"><span class="glyphicon glyphicon-lock"></span></span>
						${btnInfo}
						<span class="ve-char-sheet__spell-name" title="${`${sp.name} (granted by ${g.sourceLabel})`.qq()}">${sp.name.qq()}</span>
						<span class="ve-muted ve-small">${lvlLabel.qq()} \u2022 ${g.sourceLabel.qq()}</span>
					</div>`.appendTo(wrpGrantedRows);
				});
			ee`<div class="ve-char-sheet__spell-picker-level">
				<div class="ve-char-sheet__panel-title">Granted (always prepared)</div>
				${wrpGrantedRows}
			</div>`.appendTo(wrpLevels);
		}

		const levelKeys = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
		if (!levelKeys.length && !grantedSpells.length) {
			ee`<div class="ve-muted ve-italic ve-p-2">No spells available for your class at this level.</div>`.appendTo(wrpLevels);
		}

		levelKeys.forEach(lvl => {
			const spells = byLevel[lvl];
			const isCantrip = lvl === 0;
			const wrpRows = ee`<div class="ve-flex-col"></div>`;

			spells.forEach(sp => {
				const ref = refOf(sp);
				const k = keyOf(ref);
				// Granted spells are locked above; never show them as toggleable in the level list.
				if (grantedKeys.has(k)) return;

				const ensureSel = () => {
					let s = selected.get(k);
					if (!s) { s = {ref, level: sp.level, known: false, prepared: false}; selected.set(k, s); }
					s.level = sp.level;
					return s;
				};

				// Info/preview affordance — separate from the selection toggles so selecting can't
				// accidentally navigate to the spell page.
				const btnInfo = ee`<button class="ve-char-sheet__spell-info ve-btn ve-btn-xxs ve-btn-default" title="Preview ${sp.name.qq()}"><span class="glyphicon glyphicon-info-sign"></span></button>`
					.onn("click", () => showPreview(sp))
					.onn("mouseover", () => showPreview(sp));

				const name = ee`<span class="ve-char-sheet__spell-name" title="${sp.name.qq()}">${sp.name.qq()}</span>`;

				let primaryToggle; let prepareToggle;

				if (isCantrip) {
					// Single toggle; cantrips are always "known/prepared".
					primaryToggle = ee`<button class="ve-char-sheet__spell-toggle" title="Toggle cantrip"></button>`
						.onn("click", () => {
							const s = selected.get(k);
							if (s?.known) selected.delete(k);
							else {
								if (counts().cantrips >= totalCantrips) return;
								const ns = ensureSel(); ns.known = true; ns.prepared = true;
							}
							refreshAll();
						});
				} else if (usesKnownPool && usesPrepareStep) {
					// Spellbook caster: "In Book" + "Prepared".
					primaryToggle = ee`<button class="ve-char-sheet__spell-toggle" title="Add to spellbook"></button>`
						.onn("click", () => {
							const s = selected.get(k);
							if (s?.known) {
								// Removing from book also unprepared it.
								selected.delete(k);
							} else {
								if (counts().known >= totalKnownPool) return;
								const ns = ensureSel(); ns.known = true;
							}
							refreshAll();
						});
					prepareToggle = ee`<button class="ve-char-sheet__spell-toggle ve-char-sheet__spell-toggle--prep" title="Prepare"></button>`
						.onn("click", () => {
							const s = selected.get(k);
							if (!s?.known) return; // must be in book first
							if (s.prepared) s.prepared = false;
							else {
								if (counts().prepared >= totalPrepared) return;
								s.prepared = true;
							}
							refreshAll();
						});
				} else if (usesPrepareStep) {
					// Prepared caster: whole list known; single "Prepared" toggle.
					primaryToggle = ee`<button class="ve-char-sheet__spell-toggle ve-char-sheet__spell-toggle--prep" title="Prepare"></button>`
						.onn("click", () => {
							const s = selected.get(k);
							if (s?.prepared) selected.delete(k);
							else {
								if (counts().prepared >= totalPrepared) return;
								const ns = ensureSel(); ns.known = true; ns.prepared = true;
							}
							refreshAll();
						});
				} else {
					// Known caster: single "Known" toggle (== prepared).
					primaryToggle = ee`<button class="ve-char-sheet__spell-toggle" title="Toggle known spell"></button>`
						.onn("click", () => {
							const s = selected.get(k);
							if (s?.known) selected.delete(k);
							else {
								if (counts().known >= totalKnownPool) return;
								const ns = ensureSel(); ns.known = true; ns.prepared = true;
							}
							refreshAll();
						});
				}

				const row = ee`<div class="ve-char-sheet__spell-row ve-flex-v-center ve-char__gap-2">
					${primaryToggle}
					${prepareToggle || ""}
					${btnInfo}
					${name}
				</div>`;
				row.appendTo(wrpRows);

				rowRefreshers.push(() => {
					const s = selected.get(k);
					const isKnown = !!s?.known;
					const isPrep = !!s?.prepared;
					const c = counts();

					if (isCantrip) {
						primaryToggle.toggleClass("ve-char-sheet__spell-toggle--on", isKnown);
						primaryToggle.attr("disabled", !isKnown && c.cantrips >= totalCantrips);
						row.toggleClass("ve-char-sheet__spell-row--on", isKnown);
						return;
					}

					if (usesKnownPool && usesPrepareStep) {
						primaryToggle.toggleClass("ve-char-sheet__spell-toggle--on", isKnown);
						primaryToggle.attr("disabled", !isKnown && c.known >= totalKnownPool);
						prepareToggle.toggleClass("ve-char-sheet__spell-toggle--on", isPrep);
						prepareToggle.attr("disabled", !isKnown || (!isPrep && c.prepared >= totalPrepared));
						row.toggleClass("ve-char-sheet__spell-row--on", isKnown);
					} else if (usesPrepareStep) {
						primaryToggle.toggleClass("ve-char-sheet__spell-toggle--on", isPrep);
						primaryToggle.attr("disabled", !isPrep && c.prepared >= totalPrepared);
						row.toggleClass("ve-char-sheet__spell-row--on", isPrep);
					} else {
						primaryToggle.toggleClass("ve-char-sheet__spell-toggle--on", isKnown);
						primaryToggle.attr("disabled", !isKnown && c.known >= totalKnownPool);
						row.toggleClass("ve-char-sheet__spell-row--on", isKnown);
					}
				});
			});

			ee`<div class="ve-char-sheet__spell-picker-level">
				<div class="ve-char-sheet__panel-title">${isCantrip ? "Cantrips" : `Level ${lvl}`}</div>
				${wrpRows}
			</div>`.appendTo(wrpLevels);
		});

		const btnSave = ee`<button class="ve-btn ve-btn-primary">Save Selection</button>`
			.onn("click", async () => {
				// Persist only spells the character actually has (known cantrips, known/in-book leveled
				// spells, or — for pure prepared casters — prepared spells). Drop empty entries.
				ch.spells.known = [...selected.values()]
					.filter(s => s.known || s.prepared)
					.map(s => ({page: s.ref.page, source: s.ref.source, hash: s.ref.hash, prepared: s.prepared !== false}));
				if (this._fnOnChange) this._fnOnChange();
				this._knownSpells = (await Promise.all(ch.spells.known.map(ref => CharactersDataUtil.pGetEntity(ref).then(ent => ent ? {ref, ent} : null)))).filter(Boolean);
				doClose();
				await this.pRender(this._wrp);
			});

		// Legend explaining the toggles for the current caster kind.
		const legendBits = [];
		if (usesKnownPool && usesPrepareStep) legendBits.push(`<span class="ve-muted ve-small">First dot = in spellbook, second = prepared.</span>`);
		else if (usesPrepareStep) legendBits.push(`<span class="ve-muted ve-small">You know your whole class list; toggle which are prepared.</span>`);
		else legendBits.push(`<span class="ve-muted ve-small">Toggle the spells your character knows.</span>`);

		ee`<div class="ve-flex-col ve-w-100 ve-h-100 ve-min-h-0">
			<div class="ve-flex-col ve-char__gap-1 ve-p-2 ve-char-sheet__spell-hdr">
				<div class="ve-split-v-center ve-char__gap-3">
					<div class="ve-flex-v-center ve-char__gap-3 ve-flex-wrap">
						${hdrCantrips}
						${hdrKnown}
						${hdrPrepared}
					</div>
					${btnSave}
				</div>
				<div>${legendBits}</div>
			</div>
			<div class="ve-flex ve-w-100 ve-h-100 ve-min-h-0">
				<div class="ve-char-sheet__spell-list ve-flex-col ve-overflow-y-auto ve-min-h-0 ve-px-2">${wrpLevels}</div>
				${wrpPreview}
			</div>
		</div>`.appendTo(eleModalInner);

		refreshAll();
	}

	/**
	 * Modal for choosing Eldritch Invocations. Lists every invocation with its prerequisite text;
	 * ineligible invocations (given the character's warlock level / known spells) are marked but may
	 * still be selected (soft enforcement). The allowed count is derived from the warlock class's
	 * `optionalfeatureProgression`; selecting more than allowed shows a warning but is not blocked.
	 */
	async _pOpenInvocationManager () {
		const ch = this._character;
		ch.optionalFeatures = ch.optionalFeatures || [];

		const [allInvocations] = await Promise.all([
			CharactersDataUtil.pLoadEldritchInvocations(),
		]);

		const warlockLevel = CharactersDataUtil.getPactCasterLevel(this._classInfos);
		const allowed = CharactersDataUtil.getEldritchInvocationCount(this._classInfos);

		// Context for soft eligibility labelling.
		const knownSpellUids = new Set(
			(this._knownSpells || []).map(k => `${k.ent.name}`.toLowerCase())
				.concat((this._grantedSpells || []).map(g => `${g.ent.name}`.toLowerCase())),
		);
		const eligCtx = {warlockLevel, pactBoon: null, patron: null, knownSpellUids};

		const keyOf = (ent) => `${ent.source}|${UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_OPT_FEATURES](ent)}`.toLowerCase();

		// Working selection set, seeded from stored optional features (keyed like the entities).
		const selected = new Set(
			(ch.optionalFeatures || []).map(ref => `${ref.source}|${ref.hash}`.toLowerCase()),
		);

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Manage Eldritch Invocations",
			isWidth100: true,
			isHeight100: true,
			isUncappedHeight: true,
			cbClose: () => {},
		});

		const renderer = Renderer.get().setFirstSection(true);

		// Header count readout.
		const hdrCount = ee`<span class="ve-bold"></span>`;
		const rowRefreshers = [];
		const updateHeader = () => {
			hdrCount.txt(`Chosen ${selected.size}/${allowed}`);
			hdrCount.toggleClass("ve-char-sheet__over-limit", selected.size > allowed);
		};
		const refreshAll = () => { updateHeader(); rowRefreshers.forEach(fn => fn()); };

		// Right-hand preview pane.
		const wrpPreview = ee`<div class="ve-char-sheet__spell-preview ve-overflow-y-auto"></div>`;
		const clearPreview = () => wrpPreview.html(`<div class="ve-muted ve-italic ve-p-3 ve-text-center">Hover or click <span class="glyphicon glyphicon-info-sign"></span> on an invocation to preview it here.</div>`);
		clearPreview();
		const showPreview = (ent) => {
			wrpPreview.empty();
			ee`<table class="w-100 stats">${Renderer.optionalfeature.getCompactRenderedString(ent)}</table>`.appendTo(wrpPreview);
		};

		const wrpRows = ee`<div class="ve-flex-col ve-py-2"></div>`;

		if (!allInvocations.length) {
			ee`<div class="ve-muted ve-italic ve-p-2">No Eldritch Invocations available.</div>`.appendTo(wrpRows);
		}

		allInvocations
			.slice()
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source))
			.forEach(ent => {
				const k = keyOf(ent);
				const isEligible = CharactersDataUtil.isInvocationEligible(ent, eligCtx);
				const prereqText = ent.prerequisite
					? Renderer.utils.prerequisite.getHtml(ent.prerequisite, {isListMode: true, isTextOnly: true})
					: "";

				const btnInfo = ee`<button class="ve-char-sheet__spell-info ve-btn ve-btn-xxs ve-btn-default" title="Preview ${ent.name.qq()}"><span class="glyphicon glyphicon-info-sign"></span></button>`
					.onn("click", () => showPreview(ent))
					.onn("mouseover", () => showPreview(ent));

				const toggle = ee`<button class="ve-char-sheet__spell-toggle" title="Toggle invocation"></button>`
					.onn("click", () => {
						if (selected.has(k)) selected.delete(k);
						else selected.add(k);
						refreshAll();
					});

				const metaBits = [`${Parser.sourceJsonToAbv(ent.source)}`];
				if (prereqText) metaBits.push(prereqText);

				const row = ee`<div class="ve-char-sheet__spell-row ve-flex-v-center ve-char__gap-2">
					${toggle}
					${btnInfo}
					<span class="ve-char-sheet__spell-name ${isEligible ? "" : "ve-muted"}" title="${ent.name.qq()}">${ent.name.qq()}</span>
					<span class="ve-muted ve-small">${metaBits.join(" \u2022 ")}${isEligible ? "" : ` \u2022 <span class="ve-char-sheet__over-limit">prereq not met</span>`}</span>
				</div>`;
				row.appendTo(wrpRows);

				rowRefreshers.push(() => {
					const isSel = selected.has(k);
					toggle.toggleClass("ve-char-sheet__spell-toggle--on", isSel);
					row.toggleClass("ve-char-sheet__spell-row--on", isSel);
				});
			});

		const btnSave = ee`<button class="ve-btn ve-btn-primary">Save Invocations</button>`
			.onn("click", async () => {
				ch.optionalFeatures = allInvocations
					.filter(ent => selected.has(keyOf(ent)))
					.map(ent => ({
						page: UrlUtil.PG_OPT_FEATURES,
						source: ent.source,
						hash: UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_OPT_FEATURES](ent),
						_displayName: ent.name,
					}));
				if (this._fnOnChange) this._fnOnChange();
				this._optionalFeatures = await CharactersDataUtil.pGetCharacterOptionalFeatures(ch);
				doClose();
				await this.pRender(this._wrp);
			});

		ee`<div class="ve-flex-col ve-w-100 ve-h-100 ve-min-h-0">
			<div class="ve-flex-col ve-char__gap-1 ve-p-2 ve-char-sheet__spell-hdr">
				<div class="ve-split-v-center ve-char__gap-3">
					<div class="ve-flex-v-center ve-char__gap-3 ve-flex-wrap">
						${hdrCount}
						${warlockLevel ? "" : ee`<span class="ve-muted ve-small ve-italic">No Warlock levels — invocations shown for reference.</span>`}
					</div>
					${btnSave}
				</div>
				<div><span class="ve-muted ve-small">Ineligible invocations are marked but may still be chosen.</span></div>
			</div>
			<div class="ve-flex ve-w-100 ve-h-100 ve-min-h-0">
				<div class="ve-char-sheet__spell-list ve-flex-col ve-overflow-y-auto ve-min-h-0 ve-px-2">${wrpRows}</div>
				${wrpPreview}
			</div>
		</div>`.appendTo(eleModalInner);

		refreshAll();
	}

	/* -------------------------------------------- Proficiencies -------------------------------------------- */

	_renderProficiencies () {
		const p = this._character.proficiencies || {};
		const sections = [
			["Armor", p.armor],
			["Weapons", p.weapons],
			["Tools", p.tools],
			["Languages", p.languages],
		].filter(([, arr]) => arr && arr.length);

		if (!sections.length) return "";

		const renderer = Renderer.get();
		const renderEntry = (it) => {
			const str = it == null ? "" : it.toString();
			// Strings containing renderer tags (e.g. `{@item ...}`, `{@filter ...}`) are rendered as links;
			// plain keywords (e.g. "light", "simple") are title-cased for display.
			if (/\{@/.test(str)) return renderer.render(str);
			return str.toTitleCase().qq();
		};

		const rows = sections.map(([label, arr]) => ee`<div class="ve-char-sheet__line">
			<span class="ve-muted ve-bold">${label}:</span> <span>${arr.map(renderEntry).join(", ")}</span>
		</div>`);

		return ee`<div class="ve-char-sheet__panel">
			<div class="ve-char-sheet__panel-title">Proficiencies &amp; Languages</div>
			${rows}
		</div>`;
	}

	/* -------------------------------------------- Spellcasting -------------------------------------------- */

	_renderSpellcasting () {
		const ch = this._character;
		const fnGetCls = (ref) => (this._classInfos.find(ci => ci.ref.hash === ref.hash)?.cls) || null;

		if (!CharactersCalc.isSpellcaster(ch, fnGetCls)) return "";

		const info = CharactersCalc.getSpellcastingInfo(ch, fnGetCls);
		const slots = CharactersCalc.getSpellSlotsMax(ch, fnGetCls);
		const pactSlots = CharactersCalc.getPactMagicSlots(ch, fnGetCls);
		const limits = CharactersCalc.getSpellSelectionLimits(ch, fnGetCls);

		const infoRows = info.map(it => ee`<div class="ve-char-sheet__line ve-split-v-center">
			<span>${it.className.qq()} <span class="ve-muted ve-small">(${it.ability.toUpperCase()})</span></span>
			<span class="ve-muted ve-small">Save DC <span class="ve-bold">${it.saveDc}</span> \u2022 Atk <span class="ve-bold">${CharactersCalc.fmtBonus(it.attackBonus)}</span></span>
		</div>`);

		const slotsEle = this._renderSpellSlots(slots);
		const pactSlotsEle = this._renderPactSlots(pactSlots);
		const spellsEle = this._renderKnownSpells(limits);

		const btnManage = ee`<button class="ve-btn ve-btn-xs ve-btn-primary">Manage Spells</button>`
			.onn("click", () => this._pOpenSpellManager(limits));

		// Warlock-style classes may choose Eldritch Invocations.
		const isWarlock = CharactersDataUtil.getPactCasterLevel(this._classInfos) > 0;
		const btnInvocations = isWarlock
			? ee`<button class="ve-btn ve-btn-xs ve-btn-default">Manage Invocations</button>`
				.onn("click", () => this._pOpenInvocationManager())
			: "";

		return ee`<div class="ve-char-sheet__panel">
			<div class="ve-split-v-center">
				<div class="ve-char-sheet__panel-title ve-mb-0 ve-no-border">Spellcasting</div>
				<div class="ve-flex-v-center ve-char__gap-1">${btnInvocations}${btnManage}</div>
			</div>
			${infoRows}
			${slotsEle}
			${pactSlotsEle}
			${spellsEle}
		</div>`;
	}

	/** Render the clickable slot tracker (one pip per slot; click toggles used/available). */
	_renderSpellSlots (slotsMax) {
		const slotEntries = Object.entries(slotsMax);
		if (!slotEntries.length) return "";

		const ch = this._character;
		ch.spells = ch.spells || {};
		ch.spells.slots = ch.spells.slots || {};

		const rows = slotEntries.map(([lvl, max]) => {
			const slotState = ch.spells.slots[lvl] || {used: 0, max};
			// Keep stored max in sync with the derived value.
			slotState.max = max;
			const used = Math.min(slotState.used || 0, max);
			ch.spells.slots[lvl] = {used, max};

			const pips = [];
			for (let i = 0; i < max; ++i) {
				const isUsed = i < used;
				const pip = ee`<button class="ve-char-sheet__slot-pip ${isUsed ? "ve-char-sheet__slot-pip--used" : ""}" title="${isUsed ? "Expended" : "Available"} \u2022 click to toggle"></button>`
					.onn("click", () => this._toggleSlot(lvl, i));
				pips.push(pip);
			}

			return ee`<div class="ve-char-sheet__slot-row ve-flex-v-center ve-char__gap-2">
				<span class="ve-char-sheet__slot-lvl ve-muted ve-small ve-bold">Lvl ${lvl}</span>
				<span class="ve-flex ve-char__gap-1 ve-flex-wrap">${pips}</span>
				<span class="ve-muted ve-small">${max - used}/${max}</span>
			</div>`;
		});

		const btnRest = ee`<button class="ve-btn ve-btn-xs ve-btn-default ve-mt-1" title="Restore all expended spell slots">Long Rest \u2022 Restore Slots</button>`
			.onn("click", () => this._restoreAllSlots());

		return ee`<div class="ve-char-sheet__slots ve-flex-col ve-char__gap-1 ve-mt-2">
			${rows}
			${btnRest}
		</div>`;
	}

	/** Toggle a single slot's expended state. Clicking an available pip expends up to it; clicking an expended pip frees from it. */
	_toggleSlot (lvl, ix) {
		const ch = this._character;
		const slot = ch.spells.slots[lvl];
		if (!slot) return;
		const used = slot.used || 0;
		// If clicking an unused pip, expend through it; if clicking a used pip, restore from it.
		slot.used = ix < used ? ix : ix + 1;
		slot.used = Math.max(0, Math.min(slot.max, slot.used));
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/** Restore all expended spell slots (long rest). */
	_restoreAllSlots () {
		const ch = this._character;
		Object.values(ch.spells?.slots || {}).forEach(slot => { slot.used = 0; });
		this._restorePactSlots();
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/**
	 * Render the Warlock Pact Magic slot tracker as a separate pool (all slots the same level,
	 * regained on a short *or* long rest). No-op when the character has no pact slots.
	 */
	_renderPactSlots (pact) {
		if (!pact) return "";

		const ch = this._character;
		ch.spells = ch.spells || {};

		const {count: max, level} = pact;
		const stored = ch.spells.pact || {used: 0, max, level};
		// Keep stored max/level in sync with the derived values.
		stored.max = max;
		stored.level = level;
		const used = Math.min(stored.used || 0, max);
		ch.spells.pact = {used, max, level};

		const pips = [];
		for (let i = 0; i < max; ++i) {
			const isUsed = i < used;
			const pip = ee`<button class="ve-char-sheet__slot-pip ${isUsed ? "ve-char-sheet__slot-pip--used" : ""}" title="${isUsed ? "Expended" : "Available"} \u2022 click to toggle"></button>`
				.onn("click", () => this._togglePactSlot(i));
			pips.push(pip);
		}

		const btnRest = ee`<button class="ve-btn ve-btn-xs ve-btn-default ve-mt-1" title="Regain all Pact Magic slots (short or long rest)">Rest \u2022 Restore Pact Slots</button>`
			.onn("click", () => { this._restorePactSlots(); if (this._fnOnChange) this._fnOnChange(); return this.pRender(this._wrp); });

		return ee`<div class="ve-char-sheet__slots ve-flex-col ve-char__gap-1 ve-mt-2">
			<div class="ve-muted ve-small ve-bold">Pact Magic</div>
			<div class="ve-char-sheet__slot-row ve-flex-v-center ve-char__gap-2">
				<span class="ve-char-sheet__slot-lvl ve-muted ve-small ve-bold">Lvl ${level}</span>
				<span class="ve-flex ve-char__gap-1 ve-flex-wrap">${pips}</span>
				<span class="ve-muted ve-small">${max - used}/${max}</span>
			</div>
			${btnRest}
		</div>`;
	}

	/** Toggle a single Pact Magic slot's expended state. */
	_togglePactSlot (ix) {
		const ch = this._character;
		const pact = ch.spells?.pact;
		if (!pact) return;
		const used = pact.used || 0;
		pact.used = ix < used ? ix : ix + 1;
		pact.used = Math.max(0, Math.min(pact.max, pact.used));
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/** Regain all Pact Magic slots (short or long rest). Mutates in place; does not persist/re-render. */
	_restorePactSlots () {
		const pact = this._character.spells?.pact;
		if (pact) pact.used = 0;
	}

	/** Render the list of known/prepared spells, grouped by level, with selection-count summaries. */
	_renderKnownSpells (limits) {
		const granted = this._grantedSpells || [];
		// Granted spells are auto-known and always-prepared; they don't count against caps and can't
		// be removed. De-dupe so a granted spell isn't also shown as a manually-chosen one.
		const grantedKeys = new Set(granted.map(g => `${g.ref.source}|${g.ref.hash}`.toLowerCase()));
		const known = (this._knownSpells || []).filter(k => !grantedKeys.has(`${k.ref.source}|${k.ref.hash}`.toLowerCase()));

		// Aggregate selection caps across classes (sum; multiclass shows combined budget).
		const totalCantrips = limits.reduce((acc, l) => acc + (l.cantripsKnown || 0), 0);
		const hasPrepared = limits.some(l => l.isPrepared);
		const hasSpellbook = limits.some(l => l.casterKind === "spellbook");
		const knownPoolUnlimited = limits.some(l => l.casterKind === "prepared");
		const totalKnownPool = knownPoolUnlimited
			? Infinity
			: limits.reduce((acc, l) => acc + (Number.isFinite(l.spellsKnown) ? l.spellsKnown : 0), 0);
		const totalPrepared = limits.reduce((acc, l) => acc + (l.preparedCount || 0), 0);

		const cantripsChosen = known.filter(k => k.ent.level === 0).length;
		const leveled = known.filter(k => k.ent.level > 0);
		const leveledChosen = leveled.length;
		const preparedChosen = leveled.filter(k => k.ref?.prepared !== false).length;

		// Build summary bits appropriate to the caster kind.
		const bits = [`Cantrips ${cantripsChosen}/${totalCantrips}`];
		if (!knownPoolUnlimited) {
			const cap = Number.isFinite(totalKnownPool) ? totalKnownPool : "\u221e";
			bits.push(`${hasSpellbook ? "Spellbook" : "Known"} ${leveledChosen}/${cap}`);
		}
		if (hasPrepared) bits.push(`Prepared ${preparedChosen}/${totalPrepared}`);

		if (granted.length) bits.push(`Granted ${granted.length}`);

		const summary = ee`<div class="ve-muted ve-small ve-mt-2">${bits.join(" \u2022 ").qq()}</div>`;

		if (!known.length && !granted.length) {
			return ee`<div>
				${summary}
				<div class="ve-muted ve-italic ve-small ve-mt-1">No spells selected yet. Use "Manage Spells".</div>
			</div>`;
		}

		// Group known + granted spells by level. Granted spells are flagged so they render as locked.
		const byLevel = {};
		known.forEach(k => { (byLevel[k.ent.level] = byLevel[k.ent.level] || []).push({...k, isGranted: false}); });
		granted.forEach(g => { (byLevel[g.ent.level] = byLevel[g.ent.level] || []).push({ref: g.ref, ent: g.ent, sourceLabel: g.sourceLabel, isGranted: true}); });

		const renderer = Renderer.get();
		const levelBlocks = Object.keys(byLevel)
			.map(Number)
			.sort((a, b) => a - b)
			.map(lvl => {
				const items = byLevel[lvl]
					.sort((a, b) => SortUtil.ascSortLower(a.ent.name, b.ent.name))
					.map(k => {
						const link = renderer.render(`{@spell ${k.ent.name}|${k.ent.source}}`);
						if (k.isGranted) {
							// Granted spells are always prepared and locked; tag the granting source.
							const tip = `${k.ent.name} (granted by ${k.sourceLabel})`;
							return ee`<span class="ve-char-sheet__spell-pill ve-char-sheet__spell-pill--prepared ve-char-sheet__spell-pill--granted" title="${tip.qq()}">${link} <span class="glyphicon glyphicon-lock ve-muted ve-small"></span></span>`;
						}
						// Cantrips are always active; leveled spells are "prepared" unless flagged otherwise.
						const isPrepared = lvl === 0 || k.ref?.prepared !== false;
						// Visually mark un-prepared (in-book-but-not-prepared) spells when prepare step applies.
						const clsPrep = (hasPrepared && lvl > 0)
							? (isPrepared ? "ve-char-sheet__spell-pill--prepared" : "ve-char-sheet__spell-pill--unprepared")
							: "";
						const tipPrep = (hasPrepared && lvl > 0) ? (isPrepared ? " (prepared)" : " (not prepared)") : "";
						return ee`<span class="ve-char-sheet__spell-pill ${clsPrep}" title="${k.ent.name.qq()}${tipPrep.qq()}">${link}</span>`;
					});
				return ee`<div class="ve-char-sheet__spell-level ve-mt-1">
					<span class="ve-muted ve-small ve-bold">${lvl === 0 ? "Cantrips" : `Level ${lvl}`}</span>
					<span class="ve-flex ve-flex-wrap ve-char__gap-1">${items}</span>
				</div>`;
			});

		return ee`<div>
			${summary}
			${levelBlocks}
		</div>`;
	}

	/* -------------------------------------------- Abilities & Actions -------------------------------------------- */

	/**
	 * Render the "Abilities & Actions" panel: every ability the character can use (equipped-weapon
	 * attacks plus class/subclass, racial, feat, and background features), grouped into
	 * Action / Bonus Action / Reaction / Passive tabs. Where an ability rolls dice the player can
	 * click to roll; where it has limited uses those are tracked as pips and auto-deducted.
	 */
	_renderAbilitiesActions () {
		const ch = this._character;
		ch.abilityUses = ch.abilityUses || {};
		ch.abilityOverrides = ch.abilityOverrides || {};

		const abilities = CharactersActions.getAbilities({
			character: ch,
			classInfos: this._classInfos,
			race: this._race,
			feats: this._feats,
			background: this._background,
			inventory: this._inventory,
		});

		const wrp = ee`<div class="ve-char-sheet__panel ve-char-sheet__actions">
			<div class="ve-char-sheet__panel-title">Abilities &amp; Actions</div>
		</div>`;

		if (!abilities.length) {
			ee`<div class="ve-muted ve-italic ve-py-2">No abilities or actions available yet. Equip a weapon or add class/race/feat/background features.</div>`.appendTo(wrp);
			return wrp;
		}

		const byCat = CharactersActions.groupByCategory(abilities);

		const wrpTabBtns = ee`<div class="ve-char-sheet__act-tabs ve-flex"></div>`.appendTo(wrp);
		const wrpTabBodies = ee`<div class="ve-char-sheet__act-bodies"></div>`.appendTo(wrp);

		const btns = [];
		const bodies = [];
		const fnSelect = (ix) => {
			btns.forEach((btn, i) => btn.toggleClass("ve-char-sheet__act-tab--active", i === ix));
			bodies.forEach((body, i) => body.toggleVe(i === ix));
		};

		CharactersActions.CATEGORIES.forEach((cat, ix) => {
			const list = byCat[cat.id] || [];

			const btn = ee`<button class="ve-char-sheet__act-tab">${cat.name.qq()} <span class="ve-muted">(${list.length})</span></button>`
				.onn("click", () => fnSelect(ix))
				.appendTo(wrpTabBtns);
			btns.push(btn);

			const body = ee`<div class="ve-char-sheet__act-body"></div>`.appendTo(wrpTabBodies);
			bodies.push(body);

			if (!list.length) {
				ee`<div class="ve-muted ve-italic ve-py-2">Nothing here.</div>`.appendTo(body);
			} else {
				list.forEach(ab => this._renderAbilityRow(ab).appendTo(body));
			}
		});

		// Default to the first non-empty action tab for a useful initial view.
		const firstNonEmpty = CharactersActions.CATEGORIES.findIndex(cat => (byCat[cat.id] || []).length);
		fnSelect(firstNonEmpty < 0 ? 0 : firstNonEmpty);

		return wrp;
	}

	/** Render a single ability row (weapon attack or feature), with rolls and a uses tracker. */
	_renderAbilityRow (ab) {
		return ab.kind === "weapon"
			? this._renderWeaponAbilityRow(ab)
			: this._renderFeatureAbilityRow(ab);
	}

	/** Render an equipped-weapon attack: name, to-hit roll, and one or more damage rolls. */
	_renderWeaponAbilityRow (ab) {
		const renderer = Renderer.get();
		const w = ab.weapon;

		const nameLink = renderer.render(`{@item ${ab.ent.name}|${ab.ent.source}}`);

		const meta = [];
		meta.push(w.abil.toUpperCase());
		if (w.isRanged) meta.push("ranged");
		if (!w.isProficient) meta.push("not proficient");
		if (w.range) meta.push(`${w.range} ft.`);

		// To-hit: a clickable d20 roll via the shared packed-dice mechanism.
		const toHit = renderer.render(`{@d20 ${w.toHit >= 0 ? "+" : ""}${w.toHit}|${CharactersCalc.fmtBonus(w.toHit)}|${ab.ent.name} attack}`);

		const dmgEles = w.damage.map(d => {
			const typeFull = d.type ? Parser.dmgTypeToFull(d.type) : "";
			const rolled = renderer.render(`{@damage ${d.formula}|${d.formula}|${ab.ent.name} ${d.label.toLowerCase()}${d.type ? `|${d.type}` : ""}}`);
			return ee`<span class="ve-char-sheet__act-dmg ve-flex-v-center ve-char__gap-1" title="${d.label.qq()}${typeFull ? ` (${typeFull})` : ""}">${rolled}${typeFull ? ee`<span class="ve-muted ve-small">${typeFull.qq()}</span>` : ""}</span>`;
		});

		return ee`<div class="ve-char-sheet__act ve-char-sheet__act--weapon ve-mb-2">
			<div class="ve-char-sheet__act-head ve-flex-v-center ve-split-v-center ve-char__gap-2">
				<span class="ve-char-sheet__act-name ve-bold ve-flex-1 ve-min-w-0">${nameLink}</span>
				${this._getAbilityMenuBtn(ab)}
			</div>
			<div class="ve-char-sheet__act-attack ve-flex-v-center ve-flex-wrap ve-char__gap-2 ve-mt-1">
				<span class="ve-char-sheet__act-tohit ve-flex-v-center ve-char__gap-1" title="Attack roll">
					<span class="ve-muted ve-small">Hit</span>${toHit}
				</span>
				${dmgEles}
			</div>
			<div class="ve-muted ve-small ve-mt-1">${meta.join(" \u2022 ").qq()}</div>
		</div>`;
	}

	/** Render a feature ability: rendered description, plus a uses tracker when applicable. */
	_renderFeatureAbilityRow (ab) {
		const renderer = Renderer.get().setFirstSection(true);
		const rendered = renderer.render({type: "entries", name: ab.name, entries: ab.entries}, 1);

		const tracker = this._renderAbilityUses(ab);

		return ee`<div class="ve-char-sheet__act ve-char-sheet__act--feature rd__b ve-mb-2">
			<div class="ve-char-sheet__act-head ve-flex-v-center ve-split-v-center ve-char__gap-2">
				<span class="ve-char-sheet__act-src ve-muted ve-small">${ab.sourceLabel.qq()}</span>
				${this._getAbilityMenuBtn(ab)}
			</div>
			${rendered}
			${tracker}
		</div>`;
	}

	/**
	 * Render the limited-use tracker for an ability (one pip per use; click toggles spent/available),
	 * merging the auto-detected budget with any player-saved state. Returns "" when the ability has
	 * no tracked uses (and none configured manually).
	 */
	_renderAbilityUses (ab) {
		const ch = this._character;
		const stored = ch.abilityUses[ab.id];
		// Prefer stored (player-edited) budget; else fall back to the auto-detected one.
		const detected = ab.uses;
		const max = stored?.max ?? detected?.max ?? 0;
		if (!max) {
			// No tracked uses; offer an "Add tracking" affordance via the menu only.
			return "";
		}

		const resetOn = stored?.resetOn ?? detected?.resetOn ?? CharactersActions.RESET_LONG;
		const used = Math.min(stored?.used || 0, max);
		// Persist a normalized record so subsequent rest/reset logic has something to act on.
		ch.abilityUses[ab.id] = {used, max, resetOn};

		const pips = [];
		for (let i = 0; i < max; ++i) {
			const isUsed = i < used;
			const pip = ee`<button class="ve-char-sheet__slot-pip ${isUsed ? "ve-char-sheet__slot-pip--used" : ""}" title="${isUsed ? "Expended" : "Available"} \u2022 click to toggle"></button>`
				.onn("click", () => this._toggleAbilityUse(ab.id, i));
			pips.push(pip);
		}

		const resetLabel = resetOn === CharactersActions.RESET_SHORT ? "short rest" : resetOn === CharactersActions.RESET_LONG ? "long rest" : "manual";

		return ee`<div class="ve-char-sheet__act-uses ve-flex-v-center ve-char__gap-2 ve-mt-1">
			<span class="ve-muted ve-small ve-bold">Uses</span>
			<span class="ve-flex ve-char__gap-1 ve-flex-wrap">${pips}</span>
			<span class="ve-muted ve-small">${max - used}/${max}</span>
			<span class="ve-muted ve-small ve-italic">resets: ${resetLabel.qq()}</span>
		</div>`;
	}

	/** Toggle a single use pip's expended state (mirrors spell-slot toggling). */
	_toggleAbilityUse (id, ix) {
		const ch = this._character;
		const rec = ch.abilityUses[id];
		if (!rec) return;
		const used = rec.used || 0;
		rec.used = ix < used ? ix : ix + 1;
		rec.used = Math.max(0, Math.min(rec.max, rec.used));
		if (this._fnOnChange) this._fnOnChange();
		return this.pRender(this._wrp);
	}

	/** A small "gear" button that opens the per-ability override / uses editor. */
	_getAbilityMenuBtn (ab) {
		return ee`<button class="ve-char-sheet__act-menu ve-btn ve-btn-xxs ve-btn-default" title="Configure this ability (tab &amp; uses)"><span class="glyphicon glyphicon-cog"></span></button>`
			.onn("click", () => this._pOpenAbilityConfig(ab));
	}

	/** Open the per-ability config modal: reassign the action-economy tab and edit limited uses. */
	async _pOpenAbilityConfig (ab) {
		const ch = this._character;
		ch.abilityUses = ch.abilityUses || {};
		ch.abilityOverrides = ch.abilityOverrides || {};

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: `Configure \u2014 ${ab.name}`,
			isMinHeight0: true,
			cbClose: () => {},
		});

		// --- Tab (category) override ---
		const curCat = ch.abilityOverrides[ab.id] || ab.category;
		const selCat = ee`<select class="form-control input-sm"></select>`;
		CharactersActions.CATEGORIES.forEach(cat => {
			ee`<option value="${cat.id}" ${cat.id === curCat ? "selected" : ""}>${cat.name.qq()}</option>`.appendTo(selCat);
		});

		// --- Uses editor ---
		const cur = ch.abilityUses[ab.id] || ab.uses || {max: 0, resetOn: CharactersActions.RESET_LONG};
		const iptMax = ee`<input class="form-control input-sm ve-text-right" type="number" min="0" step="1" value="${Math.max(0, Number(cur.max) || 0)}">`;
		const selReset = ee`<select class="form-control input-sm"></select>`;
		[
			{v: CharactersActions.RESET_LONG, n: "Long rest"},
			{v: CharactersActions.RESET_SHORT, n: "Short or long rest"},
			{v: CharactersActions.RESET_NONE, n: "Manual only"},
		].forEach(o => {
			ee`<option value="${o.v}" ${o.v === (cur.resetOn || CharactersActions.RESET_LONG) ? "selected" : ""}>${o.n.qq()}</option>`.appendTo(selReset);
		});

		const btnSave = ee`<button class="ve-btn ve-btn-primary ve-mt-2">Save</button>`
			.onn("click", () => {
				// Tab override (drop when it matches the auto-detected category).
				const catVal = selCat.val();
				if (catVal && catVal !== ab.category) ch.abilityOverrides[ab.id] = catVal;
				else delete ch.abilityOverrides[ab.id];

				// Uses (drop the record entirely when max is 0).
				const max = Math.max(0, Math.floor(Number(iptMax.val()) || 0));
				if (max > 0) {
					const prev = ch.abilityUses[ab.id] || {};
					ch.abilityUses[ab.id] = {
						used: Math.min(prev.used || 0, max),
						max,
						resetOn: selReset.val() || CharactersActions.RESET_LONG,
					};
				} else {
					delete ch.abilityUses[ab.id];
				}

				if (this._fnOnChange) this._fnOnChange();
				doClose();
				this.pRender(this._wrp);
			});

		ee`<div class="ve-flex-col ve-char__gap-3 ve-p-1">
			<label class="ve-flex-col ve-char__gap-1">
				<span class="ve-muted ve-small ve-bold">Action type (tab)</span>
				${selCat}
			</label>
			<div class="ve-flex-col ve-char__gap-1">
				<span class="ve-muted ve-small ve-bold">Limited uses</span>
				<div class="ve-flex-v-center ve-char__gap-2">
					<label class="ve-flex-v-center ve-char__gap-1"><span class="ve-muted ve-small">Max</span>${iptMax}</label>
					<label class="ve-flex-v-center ve-char__gap-1"><span class="ve-muted ve-small">Resets on</span>${selReset}</label>
				</div>
				<span class="ve-muted ve-small ve-italic">Set Max to 0 to remove tracking.</span>
			</div>
			<div class="ve-flex-h-right">${btnSave}</div>
		</div>`.appendTo(eleModalInner);
	}

	/* -------------------------------------------- Features -------------------------------------------- */

	_renderFeatures () {
		const wrp = ee`<div class="ve-char-sheet__panel ve-char-sheet__features">
			<div class="ve-char-sheet__panel-title">Features &amp; Traits</div>
		</div>`;

		const tabs = [
			{id: "class", name: "Class", features: this._collectClassFeatures()},
			{id: "racial", name: "Racial", features: this._collectRacialTraits()},
			{id: "feats", name: "Feats", features: this._collectFeats()},
		];

		const invocations = this._collectInvocations();
		if (invocations.length) tabs.push({id: "invocations", name: "Invocations", features: invocations});

		const wrpTabBtns = ee`<div class="ve-char-sheet__feature-tabs ve-flex"></div>`.appendTo(wrp);
		const wrpTabBodies = ee`<div class="ve-char-sheet__feature-bodies"></div>`.appendTo(wrp);

		const renderer = Renderer.get().setFirstSection(true);
		const btns = [];
		const bodies = [];

		const fnSelect = (ix) => {
			btns.forEach((btn, i) => btn.toggleClass("ve-char-sheet__feature-tab--active", i === ix));
			bodies.forEach((body, i) => body.toggleVe(i === ix));
		};

		tabs.forEach((tab, ix) => {
			const btn = ee`<button class="ve-char-sheet__feature-tab">${tab.name.qq()} <span class="ve-muted">(${tab.features.length})</span></button>`
				.onn("click", () => fnSelect(ix))
				.appendTo(wrpTabBtns);
			btns.push(btn);

			const body = ee`<div class="ve-char-sheet__feature-body"></div>`.appendTo(wrpTabBodies);
			bodies.push(body);

			if (!tab.features.length) {
				ee`<div class="ve-muted ve-italic ve-py-2">No ${tab.name.toLowerCase()} features.</div>`.appendTo(body);
			} else {
				tab.features.forEach(feat => {
					const rendered = renderer.render(feat, 1);
					ee`<div class="ve-char-sheet__feature rd__b ve-mb-2">
						<div class="ve-char-sheet__feature-meta ve-muted ve-small">${feat._sourceLabel.qq()}</div>
						${rendered}
					</div>`.appendTo(body);
				});
			}
		});

		fnSelect(0);

		return wrp;
	}

	/**
	 * Gather class (and subclass) features for each class up to its current level.
	 * Both `classFeatures` and `subclassFeatures` are pre-dereferenced into arrays of arrays
	 * of feature objects; each feature carries its own `.level`, so we filter on that rather
	 * than assuming a particular index alignment (subclass feature arrays are packed by grant
	 * level, not character level). Results are ordered by level for a natural reading flow.
	 */
	_collectClassFeatures () {
		const out = [];

		const addFrom = (grouped, level, fnLabel) => {
			(grouped || []).forEach(group => {
				if (!Array.isArray(group)) return;
				group.forEach(feat => {
					if (!feat || typeof feat !== "object" || !feat.entries) return;
					const featLevel = feat.level || 1;
					if (featLevel > level) return;
					out.push({...feat, _level: featLevel, _sourceLabel: fnLabel(featLevel)});
				});
			});
		};

		this._classInfos.forEach(({ref, cls, subclass}) => {
			const level = ref.level || 0;
			addFrom(cls.classFeatures, level, (l) => `${cls.name} ${l}`);
			if (subclass) addFrom(subclass.subclassFeatures, level, (l) => `${cls.name}: ${subclass.name} ${l}`);
		});

		out.sort((a, b) => (a._level - b._level) || SortUtil.ascSortLower(a._sourceLabel, b._sourceLabel));
		return out;
	}

	/**
	 * Gather racial traits from the resolved race. A race's `entries` are its named traits
	 * (e.g. "Darkvision", "Fey Ancestry"); we wrap each named entry as a feature so it renders
	 * like the others. Unnamed/string entries (flavor text) are skipped.
	 */
	_collectRacialTraits () {
		if (!this._race?.entries) return [];
		const label = this._race._displayName || this._race.name || "Race";
		return this._race.entries
			.filter(ent => ent && typeof ent === "object" && ent.name && ent.entries)
			.map(ent => ({...ent, _sourceLabel: label}));
	}

	/** Gather origin (and other selected) feats as features. */
	_collectFeats () {
		return (this._feats || [])
			.filter(feat => feat && feat.entries)
			.map(feat => ({
				type: "entries",
				name: feat.name,
				entries: feat.entries,
				_sourceLabel: "Feat",
			}));
	}

	/** Gather the character's chosen Eldritch Invocations (and other optional features) as features. */
	_collectInvocations () {
		return (this._optionalFeatures || [])
			.filter(ent => ent && ent.entries)
			.map(ent => ({
				type: "entries",
				name: ent.name,
				entries: ent.entries,
				_sourceLabel: Array.isArray(ent.featureType) && ent.featureType.includes("EI") ? "Eldritch Invocation" : "Optional Feature",
			}));
	}
}

globalThis.CharacterSheet = CharacterSheet;
