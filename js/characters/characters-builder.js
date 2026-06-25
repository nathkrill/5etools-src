import {CharacterModel} from "./characters-model.js";
import {CharactersDataUtil} from "./characters-data.js";

/**
 * Guided, Charactermancer-style character builder.
 *
 * Presented as a full-screen modal with a step sidebar. Each step collects part of the
 * character (race, classes, ability scores, background, feats). On finish, the collected
 * selections are written into a character model object via {@link CharacterBuilder.getCharacter}.
 */
export class CharacterBuilder {
	static POINT_BUY_COSTS = {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9};
	static POINT_BUY_BUDGET = 27;
	static POINT_BUY_MIN = 8;
	static POINT_BUY_MAX = 15;
	static STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

	/**
	 * @param [opts]
	 * @param [opts.character] Existing character to edit (otherwise a new one is created).
	 */
	constructor ({character = null} = {}) {
		this._isEdit = !!character;
		this._baseCharacter = character ? MiscUtil.copyFast(character) : null;

		// Working selections
		this._state = {
			name: character?.name || "New Character",
			race: character?.race || null, // {page, source, hash}
			classes: this._initClasses(character), // [{ref, level, subclass}]
			background: character?.background || null,
			feats: character?.feats ? MiscUtil.copyFast(character.feats) : [],
			abilityMode: "pointbuy", // pointbuy | standard | manual
			abilityScores: {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8},
			standardAssign: {str: null, dex: null, con: null, int: null, wis: null, cha: null},
			// Chosen skills for each "choose" proficiency group, keyed by a stable group id -> string[]
			skillChoices: character?._builder?.skillChoices ? MiscUtil.copyFast(character._builder.skillChoices) : {},
			// Chosen tools for each "choose" tool-proficiency group, keyed by a stable group id -> string[]
			toolChoices: character?._builder?.toolChoices ? MiscUtil.copyFast(character._builder.toolChoices) : {},
			// Chosen starting-equipment option per block, keyed by a stable block id -> option key (e.g. "a")
			equipmentChoices: character?._builder?.equipmentChoices ? MiscUtil.copyFast(character._builder.equipmentChoices) : {},
			// Whether to take the gold alternative instead of class starting equipment
			equipmentUseGold: character?._builder?.equipmentUseGold ?? false,
		};

		if (this._isEdit && character?.abilities) {
			this._state.abilityMode = "manual";
			this._state.abilityScores = {...character.abilities};
		}

		// Loaded data lists
		this._dataRaces = null;
		this._dataClasses = null;
		this._dataBackgrounds = null;
		this._dataFeats = null;

		// Modal handles
		this._modal = null;
		this._wrpStepContent = null;
		this._wrpStepNav = null;
		this._btnPrev = null;
		this._btnNext = null;
		this._btnFinish = null;

		this._ixStep = 0;
		this._resolve = null;
	}

	_initClasses (character) {
		if (!character?.classes?.length) return [{ref: null, level: 1, subclass: null}];
		return character.classes.map(it => ({
			ref: {page: it.page, source: it.source, hash: it.hash},
			level: it.level || 1,
			subclass: it.subclass || null,
		}));
	}

	static _STEPS = [
		{id: "race", name: "Race", icon: "fa-dragon"},
		{id: "class", name: "Class", icon: "fa-shield-halved"},
		{id: "abilities", name: "Ability Scores", icon: "fa-dice-d20"},
		{id: "background", name: "Background", icon: "fa-book"},
		{id: "proficiencies", name: "Proficiencies", icon: "fa-list-check"},
		{id: "equipment", name: "Equipment", icon: "fa-briefcase"},
		{id: "feats", name: "Feats", icon: "fa-star"},
		{id: "review", name: "Review", icon: "fa-clipboard-check"},
	];

	/**
	 * Open the builder. Resolves with a character object when finished, or `null` if cancelled.
	 * @return {Promise<object|null>}
	 */
	async pOpen () {
		await this._pLoadData();

		return new Promise(resolve => {
			this._resolve = resolve;

			this._modal = UiUtil.getShowModal({
				title: this._isEdit ? "Edit Character" : "Create a Character",
				isWidth100: true,
				isHeight100: true,
				isUncappedHeight: true,
				isHeaderBorder: true,
				hasFooter: true,
				isPermanent: true,
				cbClose: (isDataEntered) => {
					if (!this._isResolved) this._resolve(null);
				},
			});

			this._render();
		});
	}

	async _pLoadData () {
		[this._dataRaces, this._dataClasses, this._dataBackgrounds, this._dataFeats] = await Promise.all([
			CharactersDataUtil.pLoadRaces(),
			CharactersDataUtil.pLoadClasses(),
			CharactersDataUtil.pLoadBackgrounds(),
			CharactersDataUtil.pLoadFeats(),
		]);
	}

	/* -------------------------------------------- Layout -------------------------------------------- */

	_render () {
		const wrp = ee`<div class="ve-char-builder ve-flex ve-w-100 ve-h-100 ve-min-h-0"></div>`;

		this._wrpStepNav = ee`<div class="ve-char-builder__nav ve-flex-col ve-no-shrink ve-overflow-y-auto"></div>`;
		this._wrpStepContent = ee`<div class="ve-char-builder__content ve-flex-col ve-w-100 ve-min-w-0 ve-overflow-y-auto ve-px-4 ve-py-3"></div>`;

		ee`<div class="ve-flex ve-w-100 ve-h-100 ve-min-h-0">${this._wrpStepNav}${this._wrpStepContent}</div>`.appendTo(wrp);

		wrp.appendTo(this._modal.eleModalInner);

		this._renderFooter();
		this._renderNav();
		this._renderStep();
	}

	_renderFooter () {
		const footer = this._modal.eleModalFooter;
		footer.empty();

		this._btnPrev = ee`<button class="ve-btn ve-btn-default"><span class="glyphicon glyphicon-chevron-left"></span> Back</button>`
			.onn("click", () => this._doStep(-1));

		this._btnNext = ee`<button class="ve-btn ve-btn-primary">Next <span class="glyphicon glyphicon-chevron-right"></span></button>`
			.onn("click", () => this._doStep(1));

		this._btnFinish = ee`<button class="ve-btn ve-btn-primary"><span class="glyphicon glyphicon-ok"></span> ${this._isEdit ? "Save" : "Create"} Character</button>`
			.onn("click", () => this._doFinish());

		const btnCancel = ee`<button class="ve-btn ve-btn-default">Cancel</button>`
			.onn("click", () => this._modal.doClose(false));

		ee`<div class="ve-split-v-center ve-w-100 ve-py-2 ve-char__gap-2">
			<div class="ve-flex-v-center ve-char__gap-2">${btnCancel}</div>
			<div class="ve-flex-v-center ve-char__gap-2">${this._btnPrev}${this._btnNext}${this._btnFinish}</div>
		</div>`.appendTo(footer);
	}

	_renderNav () {
		this._wrpStepNav.empty();
		CharacterBuilder._STEPS.forEach((step, ix) => {
			const isActive = ix === this._ixStep;
			const btn = ee`<button class="ve-char-builder__nav-btn ve-text-left ${isActive ? "ve-char-builder__nav-btn--active" : ""}" title="${step.name.qq()}">
				<span class="fa-solid ${step.icon} ve-mr-2"></span><span>${step.name.qq()}</span>
			</button>`
				.onn("click", () => this._goToStep(ix));
			btn.appendTo(this._wrpStepNav);
		});
	}

	_updateFooterButtons () {
		const isLast = this._ixStep === CharacterBuilder._STEPS.length - 1;
		this._btnPrev.toggleVe(this._ixStep > 0);
		this._btnNext.toggleVe(!isLast);
		this._btnFinish.toggleVe(isLast);
	}

	_goToStep (ix) {
		this._ixStep = Math.max(0, Math.min(CharacterBuilder._STEPS.length - 1, ix));
		this._renderNav();
		this._renderStep();
	}

	_doStep (delta) {
		this._goToStep(this._ixStep + delta);
	}

	_renderStep () {
		this._wrpStepContent.empty();
		const step = CharacterBuilder._STEPS[this._ixStep];
		switch (step.id) {
			case "race": this._renderStepRace(); break;
			case "class": this._renderStepClass(); break;
			case "abilities": this._renderStepAbilities(); break;
			case "background": this._renderStepBackground(); break;
			case "proficiencies": this._renderStepProficiencies(); break;
			case "equipment": this._renderStepEquipment(); break;
			case "feats": this._renderStepFeats(); break;
			case "review": this._renderStepReview(); break;
		}
		this._updateFooterButtons();
		this._wrpStepContent.scrollTop = 0;
	}

	/* -------------------------------------------- Generic picker -------------------------------------------- */

	/**
	 * Render a searchable single-select entity picker with a live preview.
	 * @param opts
	 * @param opts.title Heading text.
	 * @param opts.entities Array of entities to choose from.
	 * @param opts.page The PG_* page constant (for ref + hover).
	 * @param opts.selectedRef Current `{page, source, hash}` selection (or null).
	 * @param opts.fnOnSelect Called with the new ref (or null) on change.
	 * @param [opts.isAllowNull] Allow clearing the selection.
	 */
	_renderEntityPicker ({title, entities, page, selectedRef, fnOnSelect, isAllowNull = true, extraTopEle = null}) {
		const wrp = ee`<div class="ve-flex-col ve-w-100"></div>`.appendTo(this._wrpStepContent);

		ee`<h4 class="ve-mt-0 ve-mb-2">${title.qq()}</h4>`.appendTo(wrp);

		if (extraTopEle) extraTopEle.appendTo(wrp);

		const byHash = {};
		entities.forEach(ent => { byHash[UrlUtil.URL_TO_HASH_BUILDER[page](ent)] = ent; });

		const wrpPreview = ee`<div class="ve-char-builder__preview ve-flex-col ve-w-100 ve-mt-3 ve-overflow-y-auto"></div>`;

		const doRenderPreview = (ref) => {
			wrpPreview.empty();
			if (!ref) {
				ee`<div class="ve-muted ve-italic">Nothing selected.</div>`.appendTo(wrpPreview);
				return;
			}
			const ent = byHash[ref.hash];
			if (!ent) {
				ee`<div class="ve-muted ve-italic">Selected content is unavailable.</div>`.appendTo(wrpPreview);
				return;
			}
			const rendered = Renderer.get().setFirstSection(true).render({type: "entries", entries: ent.entries || []});
			ee`<div class="rd__b">${rendered}</div>`.appendTo(wrpPreview);
		};

		// Lightweight component to drive the searchable select
		const comp = BaseComponent.fromObject({sel: selectedRef ? selectedRef.hash : null});
		const values = [
			...(isAllowNull ? [] : []),
			...entities.map(ent => UrlUtil.URL_TO_HASH_BUILDER[page](ent)),
		];
		const selEle = ComponentUiUtil.getSelSearchable(
			comp,
			"sel",
			{
				values,
				isAllowNull,
				displayNullAs: "\u2014",
				fnDisplay: (hash) => hash == null ? "\u2014" : CharactersDataUtil.getDisplayWithSource(byHash[hash]),
			},
		);
		comp._addHookBase("sel", () => {
			const hash = comp._state.sel;
			const ref = hash == null ? null : {page, source: byHash[hash].source, hash};
			fnOnSelect(ref);
			doRenderPreview(ref);
		});

		ee`<label class="ve-flex-col ve-w-100" style="max-width: 480px;">
			<span class="ve-muted ve-mb-1">Search</span>
			${selEle}
		</label>`.appendTo(wrp);

		wrpPreview.appendTo(wrp);
		doRenderPreview(selectedRef);

		return wrp;
	}

	/* -------------------------------------------- Race -------------------------------------------- */

	_renderStepRace () {
		this._renderEntityPicker({
			title: "Choose a Race",
			entities: this._dataRaces,
			page: UrlUtil.PG_RACES,
			selectedRef: this._state.race,
			fnOnSelect: (ref) => { this._state.race = ref; },
			extraTopEle: this._getNameInputEle(),
		});
	}

	_getNameInputEle () {
		const iptName = ee`<input type="text" class="form-control" placeholder="Character name" value="${(this._state.name || "").qq()}">`
			.onn("change", () => { this._state.name = iptName.value.trim() || "New Character"; });
		return ee`<label class="ve-flex-col ve-w-100 ve-mb-3" style="max-width: 480px;">
			<span class="ve-muted ve-mb-1">Character Name</span>
			${iptName}
		</label>`;
	}

	/* -------------------------------------------- Class -------------------------------------------- */

	_renderStepClass () {
		const wrp = ee`<div class="ve-flex-col ve-w-100"></div>`.appendTo(this._wrpStepContent);
		ee`<h4 class="ve-mt-0 ve-mb-2">Classes &amp; Levels</h4>`.appendTo(wrp);
		ee`<div class="ve-muted ve-mb-3">Add one or more classes (multiclassing). Each class entry has its own level and subclass.</div>`.appendTo(wrp);

		const wrpClasses = ee`<div class="ve-flex-col ve-w-100 ve-char__gap-2"></div>`.appendTo(wrp);

		const doRender = () => {
			wrpClasses.empty();
			this._state.classes.forEach((clsEntry, ix) => this._renderClassRow(wrpClasses, clsEntry, ix, doRender));

			const total = this._state.classes.reduce((acc, it) => acc + (it.level || 0), 0);
			ee`<div class="ve-split-v-center ve-w-100 ve-mt-2">
				<button class="ve-btn ve-btn-default ve-btn-sm"><span class="glyphicon glyphicon-plus"></span> Add Class</button>
				<div class="ve-bold">Total level: ${total}</div>
			</div>`
				.onn("click", evt => {
					if (evt.target.closest("button")) {
						this._state.classes.push({ref: null, level: 1, subclass: null});
						doRender();
					}
				})
				.appendTo(wrpClasses);
		};
		doRender();
	}

	_renderClassRow (parent, clsEntry, ix, fnReRender) {
		const row = ee`<div class="ve-char-builder__class-row ve-flex-col ve-w-100 ve-p-3"></div>`.appendTo(parent);

		const byHash = {};
		this._dataClasses.forEach(cls => { byHash[UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls)] = cls; });

		const comp = BaseComponent.fromObject({sel: clsEntry.ref ? clsEntry.ref.hash : null});
		const selClass = ComponentUiUtil.getSelSearchable(
			comp,
			"sel",
			{
				values: this._dataClasses.map(cls => UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls)),
				isAllowNull: true,
				displayNullAs: "Select a class\u2026",
				fnDisplay: (hash) => hash == null ? "Select a class\u2026" : CharactersDataUtil.getDisplayWithSource(byHash[hash]),
			},
		);

		const wrpSubclass = ee`<div class="ve-flex-col ve-w-100"></div>`;

		const doRenderSubclass = () => {
			wrpSubclass.empty();
			const cls = clsEntry.ref ? byHash[clsEntry.ref.hash] : null;
			if (!cls || !cls.subclasses?.length) {
				clsEntry.subclass = null;
				return;
			}

			const scByHash = {};
			cls.subclasses.forEach(sc => { scByHash[UrlUtil.URL_TO_HASH_BUILDER["subclass"](sc)] = sc; });

			const compSc = BaseComponent.fromObject({sel: clsEntry.subclass ? clsEntry.subclass.hash : null});
			const selSc = ComponentUiUtil.getSelSearchable(
				compSc,
				"sel",
				{
					values: cls.subclasses.map(sc => UrlUtil.URL_TO_HASH_BUILDER["subclass"](sc)),
					isAllowNull: true,
					displayNullAs: "No subclass",
					fnDisplay: (hash) => hash == null ? "No subclass" : scByHash[hash].name,
				},
			);
			compSc._addHookBase("sel", () => {
				const hash = compSc._state.sel;
				clsEntry.subclass = hash == null ? null : {page: "subclass", source: scByHash[hash].source, hash};
			});

			ee`<label class="ve-flex-col ve-mt-2" style="max-width: 320px;">
				<span class="ve-muted ve-mb-1">${(cls.subclassTitle || "Subclass").qq()}</span>
				${selSc}
			</label>`.appendTo(wrpSubclass);
		};

		comp._addHookBase("sel", () => {
			const hash = comp._state.sel;
			clsEntry.ref = hash == null ? null : {page: UrlUtil.PG_CLASSES, source: byHash[hash].source, hash};
			clsEntry.subclass = null;
			doRenderSubclass();
		});

		const iptLevel = ee`<input type="number" class="form-control ve-char-builder__ipt-lvl" min="1" max="20" value="${clsEntry.level || 1}">`
			.onn("change", () => {
				let v = Number(iptLevel.value);
				if (isNaN(v)) v = 1;
				v = Math.max(1, Math.min(20, Math.round(v)));
				iptLevel.value = `${v}`;
				clsEntry.level = v;
			});

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-sm" title="Remove class"><span class="glyphicon glyphicon-trash"></span></button>`
			.onn("click", () => {
				if (this._state.classes.length <= 1) {
					this._state.classes[0] = {ref: null, level: 1, subclass: null};
				} else {
					this._state.classes.splice(ix, 1);
				}
				fnReRender();
			});

		ee`<div class="ve-flex-v-end ve-flex-wrap ve-char__gap-2 ve-w-100">
			<label class="ve-flex-col" style="flex: 1 1 240px; min-width: 200px;">
				<span class="ve-muted ve-mb-1">Class</span>
				${selClass}
			</label>
			<label class="ve-flex-col" style="width: 88px;">
				<span class="ve-muted ve-mb-1">Level</span>
				${iptLevel}
			</label>
			${btnRemove}
		</div>`.appendTo(row);

		wrpSubclass.appendTo(row);
		doRenderSubclass();
	}

	/* -------------------------------------------- Abilities -------------------------------------------- */

	_renderStepAbilities () {
		const wrp = ee`<div class="ve-flex-col ve-w-100"></div>`.appendTo(this._wrpStepContent);
		ee`<h4 class="ve-mt-0 ve-mb-2">Ability Scores</h4>`.appendTo(wrp);

		const wrpMode = ee`<div class="ve-flex-v-center ve-char__gap-2 ve-mb-3"></div>`.appendTo(wrp);
		const modes = [
			{id: "pointbuy", name: "Point Buy"},
			{id: "standard", name: "Standard Array"},
			{id: "manual", name: "Manual"},
		];
		modes.forEach(mode => {
			const btn = ee`<button class="ve-btn ve-btn-sm ${this._state.abilityMode === mode.id ? "ve-btn-primary" : "ve-btn-default"}">${mode.name}</button>`
				.onn("click", () => { this._state.abilityMode = mode.id; this._renderStep(); });
			btn.appendTo(wrpMode);
		});

		const wrpBody = ee`<div class="ve-flex-col ve-w-100"></div>`.appendTo(wrp);
		switch (this._state.abilityMode) {
			case "pointbuy": this._renderAbilitiesPointBuy(wrpBody); break;
			case "standard": this._renderAbilitiesStandard(wrpBody); break;
			case "manual": this._renderAbilitiesManual(wrpBody); break;
		}
	}

	_getRaceAbilityBonusText () {
		// Display flat racial ability bonuses if unambiguous; choose-style bonuses are noted generically.
		return null;
	}

	_renderAbilitiesPointBuy (parent) {
		// Ensure scores are within point-buy range.
		CharacterModel.ABILITIES.forEach(ab => {
			const cur = this._state.abilityScores[ab];
			if (cur < CharacterBuilder.POINT_BUY_MIN || cur > CharacterBuilder.POINT_BUY_MAX) this._state.abilityScores[ab] = CharacterBuilder.POINT_BUY_MIN;
		});

		const wrpRemaining = ee`<div class="ve-bold ve-mb-3"></div>`.appendTo(parent);

		const updateRemaining = () => {
			const spent = CharacterModel.ABILITIES.reduce((acc, ab) => acc + CharacterBuilder.POINT_BUY_COSTS[this._state.abilityScores[ab]], 0);
			const remaining = CharacterBuilder.POINT_BUY_BUDGET - spent;
			wrpRemaining.empty();
			ee`<span class="${remaining < 0 ? "text-danger" : ""}">Points remaining: ${remaining} / ${CharacterBuilder.POINT_BUY_BUDGET}</span>`.appendTo(wrpRemaining);
		};

		const wrpRows = ee`<div class="ve-flex-col ve-char__gap-2 ve-w-100" style="max-width: 420px;"></div>`.appendTo(parent);

		CharacterModel.ABILITIES.forEach(ab => {
			const row = ee`<div class="ve-split-v-center ve-w-100"></div>`.appendTo(wrpRows);

			const dispScore = ee`<span class="ve-char-builder__score ve-bold"></span>`;
			const dispMod = ee`<span class="ve-muted ve-ml-2"></span>`;

			const updateDisp = () => {
				const v = this._state.abilityScores[ab];
				dispScore.txt(`${v}`);
				const mod = CharacterModel.getAbilityModifier(v);
				dispMod.txt(`(${mod >= 0 ? "+" : ""}${mod})`);
			};

			const btnDec = ee`<button class="ve-btn ve-btn-default ve-btn-xs">\u2212</button>`
				.onn("click", () => {
					if (this._state.abilityScores[ab] > CharacterBuilder.POINT_BUY_MIN) {
						this._state.abilityScores[ab]--;
						updateDisp(); updateRemaining();
					}
				});
			const btnInc = ee`<button class="ve-btn ve-btn-default ve-btn-xs">+</button>`
				.onn("click", () => {
					const cur = this._state.abilityScores[ab];
					if (cur >= CharacterBuilder.POINT_BUY_MAX) return;
					const spent = CharacterModel.ABILITIES.reduce((acc, a) => acc + CharacterBuilder.POINT_BUY_COSTS[this._state.abilityScores[a]], 0);
					const costNext = CharacterBuilder.POINT_BUY_COSTS[cur + 1] - CharacterBuilder.POINT_BUY_COSTS[cur];
					if (spent + costNext > CharacterBuilder.POINT_BUY_BUDGET) return;
					this._state.abilityScores[ab]++;
					updateDisp(); updateRemaining();
				});

			ee`<div class="ve-flex-v-center ve-w-100 ve-split-v-center">
				<span class="ve-bold ve-char-builder__ab-name">${CharacterModel.ABILITY_TO_FULL[ab]}</span>
				<span class="ve-flex-v-center ve-char__gap-2">${btnDec}${dispScore}${btnInc}${dispMod}</span>
			</div>`.appendTo(row);

			updateDisp();
		});

		updateRemaining();
	}

	_renderAbilitiesStandard (parent) {
		ee`<div class="ve-muted ve-mb-3">Assign each value from the standard array [15, 14, 13, 12, 10, 8] to an ability.</div>`.appendTo(parent);

		const wrpRows = ee`<div class="ve-flex-col ve-char__gap-2 ve-w-100" style="max-width: 420px;"></div>`.appendTo(parent);

		const getUsedValues = () => CharacterModel.ABILITIES
			.map(ab => this._state.standardAssign[ab])
			.filter(it => it != null);

		const rerender = () => this._renderStep();

		CharacterModel.ABILITIES.forEach(ab => {
			const row = ee`<div class="ve-split-v-center ve-w-100"></div>`.appendTo(wrpRows);

			const cur = this._state.standardAssign[ab];
			const used = getUsedValues();

			const comp = BaseComponent.fromObject({sel: cur});
			// Show all array values; values already taken by other abilities are marked "(used)".
			const values = [...new Set(CharacterBuilder.STANDARD_ARRAY)].sort((a, b) => b - a);

			const sel = ComponentUiUtil.getSelEnum(
				comp,
				"sel",
				{
					values,
					isAllowNull: true,
					displayNullAs: "\u2014",
					fnDisplay: (v) => v == null ? "\u2014" : `${v}${used.includes(v) && v !== cur ? " (used)" : ""}`,
				},
			);
			comp._addHookBase("sel", () => {
				const v = comp._state.sel;
				// Prevent duplicate assignment
				if (v != null && getUsedValues().includes(v) && this._state.standardAssign[ab] !== v) {
					comp._state.sel = this._state.standardAssign[ab];
					return;
				}
				this._state.standardAssign[ab] = v;
				rerender();
			});

			const modTxt = cur != null ? (() => { const m = CharacterModel.getAbilityModifier(cur); return `(${m >= 0 ? "+" : ""}${m})`; })() : "";

			ee`<div class="ve-flex-v-center ve-w-100 ve-split-v-center">
				<span class="ve-bold ve-char-builder__ab-name">${CharacterModel.ABILITY_TO_FULL[ab]}</span>
				<span class="ve-flex-v-center ve-char__gap-2">${sel}<span class="ve-muted" style="min-width: 36px;">${modTxt}</span></span>
			</div>`.appendTo(row);
		});
	}

	_renderAbilitiesManual (parent) {
		ee`<div class="ve-muted ve-mb-3">Enter final ability scores directly.</div>`.appendTo(parent);

		const wrpRows = ee`<div class="ve-flex-col ve-char__gap-2 ve-w-100" style="max-width: 420px;"></div>`.appendTo(parent);

		CharacterModel.ABILITIES.forEach(ab => {
			const row = ee`<div class="ve-split-v-center ve-w-100"></div>`.appendTo(wrpRows);

			const dispMod = ee`<span class="ve-muted" style="min-width: 36px;"></span>`;
			const updateMod = (v) => { const m = CharacterModel.getAbilityModifier(v); dispMod.txt(`(${m >= 0 ? "+" : ""}${m})`); };

			const ipt = ee`<input type="number" class="form-control ve-char-builder__ipt-score" min="1" max="30" value="${this._state.abilityScores[ab]}">`
				.onn("change", () => {
					let v = Number(ipt.value);
					if (isNaN(v)) v = 10;
					v = Math.max(1, Math.min(30, Math.round(v)));
					ipt.value = `${v}`;
					this._state.abilityScores[ab] = v;
					updateMod(v);
				});

			updateMod(this._state.abilityScores[ab]);

			ee`<div class="ve-flex-v-center ve-w-100 ve-split-v-center">
				<span class="ve-bold ve-char-builder__ab-name">${CharacterModel.ABILITY_TO_FULL[ab]}</span>
				<span class="ve-flex-v-center ve-char__gap-2">${ipt}${dispMod}</span>
			</div>`.appendTo(row);
		});
	}

	/* -------------------------------------------- Background -------------------------------------------- */

	_renderStepBackground () {
		this._renderEntityPicker({
			title: "Choose a Background",
			entities: this._dataBackgrounds,
			page: UrlUtil.PG_BACKGROUNDS,
			selectedRef: this._state.background,
			fnOnSelect: (ref) => { this._state.background = ref; },
		});
	}

	/* -------------------------------------------- Proficiencies -------------------------------------------- */

	/**
	 * Gather proficiency sources from the selected race, primary class, and background.
	 * Returns `{saves, fixedSkills, skillGroups, armor, weapons, toolFixed, toolGroups, languages, hitDice}`
	 * where `skillGroups`/`toolGroups` are `[{id, label, from, count}]` for interactive "choose" selections.
	 */
	_getProficiencyData () {
		const out = {
			saves: [],
			fixedSkills: [],
			skillGroups: [],
			armor: [],
			weapons: [],
			toolFixed: [],
			toolGroups: [],
			languages: [],
			hitDice: [],
		};

		const race = this._state.race ? this._findByHash(this._dataRaces, UrlUtil.PG_RACES, this._state.race.hash) : null;
		const bg = this._state.background ? this._findByHash(this._dataBackgrounds, UrlUtil.PG_BACKGROUNDS, this._state.background.hash) : null;
		const clsEntries = this._state.classes
			.filter(it => it.ref)
			.map(it => ({entry: it, cls: this._findByHash(this._dataClasses, UrlUtil.PG_CLASSES, it.ref.hash)}))
			.filter(it => it.cls);

		// Saves come from the primary (first) class only, per D&D multiclassing rules.
		if (clsEntries.length) {
			out.saves = CharactersDataUtil.getClassSaveProficiencies(clsEntries[0].cls);
		}

		// Hit dice: one pool per class.
		clsEntries.forEach(({entry, cls}) => {
			const hd = CharactersDataUtil.getClassHitDie(cls);
			if (hd) out.hitDice.push({die: hd.die, faces: hd.faces, total: entry.level || 1, used: 0});
		});

		// Armor / weapons / tools from the primary class.
		if (clsEntries.length) {
			out.armor = CharactersDataUtil.getClassSimpleProficiencies(clsEntries[0].cls, "armor");
			out.weapons = CharactersDataUtil.getClassSimpleProficiencies(clsEntries[0].cls, "weapons");

			const parsedTools = CharactersDataUtil.parseToolProficiencies(clsEntries[0].cls);
			out.toolFixed = parsedTools.fixed;
			out.toolGroups = parsedTools.choices;
		}

		const addSkillSource = (blocks, label, idPrefix) => {
			const parsed = CharactersDataUtil.parseSkillProficiencies(blocks);
			out.fixedSkills.push(...parsed.fixed);
			parsed.choices.forEach((ch, i) => out.skillGroups.push({
				id: `${idPrefix}-${i}`,
				label,
				from: ch.from,
				count: ch.count,
			}));
		};

		if (clsEntries.length) addSkillSource(clsEntries[0].cls.startingProficiencies?.skills, `${clsEntries[0].cls.name} (class)`, "cls");
		if (race) addSkillSource(race.skillProficiencies, `${race.name} (race)`, "race");
		if (bg) addSkillSource(bg.skillProficiencies, `${bg.name} (background)`, "bg");

		// De-duplicate fixed skills.
		out.fixedSkills = [...new Set(out.fixedSkills)];

		return out;
	}

	_renderStepProficiencies () {
		const wrp = ee`<div class="ve-flex-col ve-w-100" style="max-width: 560px;"></div>`.appendTo(this._wrpStepContent);
		ee`<h4 class="ve-mt-0 ve-mb-2">Proficiencies</h4>`.appendTo(wrp);

		const data = this._getProficiencyData();

		if (!this._state.classes.some(it => it.ref) && !this._state.race && !this._state.background) {
			ee`<div class="ve-muted ve-italic">Choose a race, class, and background first to see available proficiencies.</div>`.appendTo(wrp);
			return;
		}

		// Prune stale skill choices for groups that no longer exist (e.g. class/race changed).
		const liveGroupIds = new Set(data.skillGroups.map(g => g.id));
		Object.keys(this._state.skillChoices).forEach(k => { if (!liveGroupIds.has(k)) delete this._state.skillChoices[k]; });

		// Prune stale tool choices for groups that no longer exist.
		const liveToolGroupIds = new Set(data.toolGroups.map(g => g.id));
		Object.keys(this._state.toolChoices).forEach(k => { if (!liveToolGroupIds.has(k)) delete this._state.toolChoices[k]; });

		// region Saving throws (auto)
		ee`<div class="ve-bold ve-mt-2 ve-mb-1">Saving Throws</div>`.appendTo(wrp);
		if (data.saves.length) {
			const saveStr = data.saves.map(s => CharacterModel.ABILITY_TO_FULL[s]).join(", ");
			ee`<div class="ve-mb-3">${saveStr.qq()} <span class="ve-muted ve-italic">(from class)</span></div>`.appendTo(wrp);
		} else {
			ee`<div class="ve-muted ve-italic ve-mb-3">Select a class to gain saving-throw proficiencies.</div>`.appendTo(wrp);
		}
		// endregion

		// region Skills
		ee`<div class="ve-bold ve-mt-2 ve-mb-1">Skills</div>`.appendTo(wrp);

		if (data.fixedSkills.length) {
			const fixedStr = data.fixedSkills.map(s => this._titleCaseSkill(s)).join(", ");
			ee`<div class="ve-mb-2">${fixedStr.qq()} <span class="ve-muted ve-italic">(granted)</span></div>`.appendTo(wrp);
		}

		if (!data.skillGroups.length && !data.fixedSkills.length) {
			ee`<div class="ve-muted ve-italic ve-mb-2">No skill proficiencies available from your current selections.</div>`.appendTo(wrp);
		}

		// Skills already locked in (fixed) cannot be re-picked in a choice group.
		const lockedSkills = new Set(data.fixedSkills);

		const reRenderStep = () => this._renderStep();

		data.skillGroups.forEach(group => {
			this._renderSkillChoiceGroup(wrp, group, lockedSkills, reRenderStep);
		});
		// endregion

		// region Other proficiencies (armor / weapons are auto; tools may include choices)
		const renderer = Renderer.get();
		// Render any embedded `{@item ...}`/`{@filter ...}` tags as links; title-case plain keywords.
		const renderProfEntry = (it) => {
			const str = it == null ? "" : it.toString();
			if (/\{@/.test(str)) return renderer.render(str);
			return str.toTitleCase().qq();
		};
		const addSimple = (label, list) => {
			if (!list?.length) return;
			ee`<div class="ve-split-v-center ve-w-100 ve-py-1 ve-char-builder__review-row">
				<span class="ve-muted">${label.qq()}</span><span class="ve-text-right">${list.map(renderProfEntry).join(", ")}</span>
			</div>`.appendTo(wrp);
		};
		ee`<div class="ve-bold ve-mt-3 ve-mb-1">Other Proficiencies <span class="ve-muted ve-italic ve-small">(from class)</span></div>`.appendTo(wrp);
		addSimple("Armor", data.armor);
		addSimple("Weapons", data.weapons);
		addSimple("Tools", data.toolFixed);
		if (!data.armor.length && !data.weapons.length && !data.toolFixed.length && !data.toolGroups.length) {
			ee`<div class="ve-muted ve-italic">None.</div>`.appendTo(wrp);
		}
		// endregion

		// region Tool proficiency choices (interactive)
		data.toolGroups.forEach(group => {
			this._renderToolChoiceGroup(wrp, group, reRenderStep);
		});
		// endregion
	}

	_renderToolChoiceGroup (parent, group, fnReRender) {
		const chosen = this._state.toolChoices[group.id] ||= [];
		// Drop any chosen tools that are no longer offered by this group.
		const filtered = chosen.filter(t => group.from.includes(t));
		if (filtered.length !== chosen.length) this._state.toolChoices[group.id] = filtered;

		const numChosen = this._state.toolChoices[group.id].length;
		const remaining = group.count - numChosen;

		const wrpGroup = ee`<div class="ve-char-builder__class-row ve-flex-col ve-w-100 ve-p-3 ve-mb-2 ve-mt-2"></div>`.appendTo(parent);
		ee`<div class="ve-split-v-center ve-w-100 ve-mb-2">
			<span class="ve-bold">${group.label.qq()}</span>
			<span class="${remaining < 0 ? "text-danger" : "ve-muted"}">Choose ${group.count} \u2014 ${remaining} remaining</span>
		</div>`.appendTo(wrpGroup);

		const wrpChecks = ee`<div class="ve-flex-wrap ve-w-100 ve-char__gap-2"></div>`.appendTo(wrpGroup);

		group.from.forEach(tool => {
			const cur = this._state.toolChoices[group.id];
			const isChecked = cur.includes(tool);
			// Disabled if picked in another live group, or this group is already at its limit.
			const isInOtherGroup = !isChecked && this._isToolChosenInOtherGroup(tool, group.id);
			const isAtLimit = !isChecked && remaining <= 0;
			const isDisabled = isInOtherGroup || isAtLimit;

			const cb = ee`<input type="checkbox" class="ve-mr-1" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}>`
				.onn("change", () => {
					const list = this._state.toolChoices[group.id];
					if (cb.checked) {
						if (!list.includes(tool)) list.push(tool);
					} else {
						const ix = list.indexOf(tool);
						if (ix >= 0) list.splice(ix, 1);
					}
					fnReRender();
				});

			ee`<label class="ve-flex-v-center ve-mb-1 ${isDisabled && !isChecked ? "ve-muted" : ""}" style="flex: 0 0 calc(50% - 8px); min-width: 160px; cursor: ${isDisabled ? "default" : "pointer"};">
				${cb}<span>${tool.toTitleCase().qq()}</span>
			</label>`.appendTo(wrpChecks);
		});
	}

	_isToolChosenInOtherGroup (tool, exceptGroupId) {
		return Object.entries(this._state.toolChoices)
			.some(([gid, list]) => gid !== exceptGroupId && list.includes(tool));
	}

	_renderSkillChoiceGroup (parent, group, lockedSkills, fnReRender) {
		const chosen = this._state.skillChoices[group.id] ||= [];
		// Drop any chosen skills that became locked/unavailable.
		const filtered = chosen.filter(s => group.from.includes(s) && !lockedSkills.has(s));
		if (filtered.length !== chosen.length) this._state.skillChoices[group.id] = filtered;

		const numChosen = this._state.skillChoices[group.id].length;
		const remaining = group.count - numChosen;

		const wrpGroup = ee`<div class="ve-char-builder__class-row ve-flex-col ve-w-100 ve-p-3 ve-mb-2"></div>`.appendTo(parent);
		ee`<div class="ve-split-v-center ve-w-100 ve-mb-2">
			<span class="ve-bold">${group.label.qq()}</span>
			<span class="${remaining < 0 ? "text-danger" : "ve-muted"}">Choose ${group.count} \u2014 ${remaining} remaining</span>
		</div>`.appendTo(wrpGroup);

		const wrpChecks = ee`<div class="ve-flex-wrap ve-w-100 ve-char__gap-2"></div>`.appendTo(wrpGroup);

		group.from.forEach(skill => {
			const cur = this._state.skillChoices[group.id];
			const isChecked = cur.includes(skill);
			// Disabled if locked elsewhere (fixed) or picked in another live group, unless already checked here.
			const isLockedElsewhere = lockedSkills.has(skill);
			const isInOtherGroup = !isChecked && this._isSkillChosenInOtherGroup(skill, group.id);
			const isAtLimit = !isChecked && remaining <= 0;
			const isDisabled = isLockedElsewhere || isInOtherGroup || isAtLimit;

			const cb = ee`<input type="checkbox" class="ve-mr-1" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}>`
				.onn("change", () => {
					const list = this._state.skillChoices[group.id];
					if (cb.checked) {
						if (!list.includes(skill)) list.push(skill);
					} else {
						const ix = list.indexOf(skill);
						if (ix >= 0) list.splice(ix, 1);
					}
					fnReRender();
				});

			ee`<label class="ve-flex-v-center ve-mb-1 ${isDisabled && !isChecked ? "ve-muted" : ""}" style="flex: 0 0 calc(50% - 8px); min-width: 160px; cursor: ${isDisabled ? "default" : "pointer"};">
				${cb}<span>${this._titleCaseSkill(skill)}</span>
			</label>`.appendTo(wrpChecks);
		});
	}

	_isSkillChosenInOtherGroup (skill, exceptGroupId) {
		return Object.entries(this._state.skillChoices)
			.some(([gid, list]) => gid !== exceptGroupId && list.includes(skill));
	}

	_titleCaseSkill (str) {
		return (str || "").replace(/\b\w/g, c => c.toUpperCase());
	}

	/** Final resolved skill proficiency list (fixed + all chosen), de-duplicated. */
	_getResolvedProficiencies () {
		const data = this._getProficiencyData();
		const skills = new Set(data.fixedSkills);
		Object.values(this._state.skillChoices).forEach(list => list.forEach(s => skills.add(s)));

		// Tools = fixed tools + tools chosen in each live choice group, de-duplicated.
		const liveToolGroupIds = new Set(data.toolGroups.map(g => g.id));
		const tools = [...data.toolFixed];
		Object.entries(this._state.toolChoices).forEach(([gid, list]) => {
			if (!liveToolGroupIds.has(gid)) return;
			list.forEach(t => { if (!tools.includes(t)) tools.push(t); });
		});

		return {
			saves: data.saves,
			skills: [...skills],
			armor: data.armor,
			weapons: data.weapons,
			tools,
			hitDice: data.hitDice,
		};
	}

	/* -------------------------------------------- Equipment -------------------------------------------- */

	/**
	 * Gather the raw `startingEquipment` from the primary class and the background, plus the
	 * class' gold alternative. Returns `{clsSource, bgSource, clsEquip, bgEquip, goldAlternative}`.
	 */
	_getStartingEquipmentSources () {
		const clsEntry = this._state.classes.find(it => it.ref);
		const cls = clsEntry ? this._findByHash(this._dataClasses, UrlUtil.PG_CLASSES, clsEntry.ref.hash) : null;
		const bg = this._state.background ? this._findByHash(this._dataBackgrounds, UrlUtil.PG_BACKGROUNDS, this._state.background.hash) : null;

		// Classes store structured data in `startingEquipment.defaultData`; backgrounds use the array form directly.
		const clsEquip = cls?.startingEquipment?.defaultData || null;
		const bgEquip = Array.isArray(bg?.startingEquipment) ? bg.startingEquipment : null;

		return {
			cls,
			bg,
			clsName: cls?.name || null,
			bgName: bg?.name || null,
			clsEquip,
			bgEquip,
			goldAlternative: cls?.startingEquipment?.goldAlternative || null,
		};
	}

	/** Parse (async) both sources into builder groups, caching the result for the current selections. */
	async _pLoadEquipmentGroups () {
		const src = this._getStartingEquipmentSources();
		const key = `${src.clsName || ""}|${src.bgName || ""}`;
		if (this._equipmentGroupsCache?.key === key) return this._equipmentGroupsCache.groups;

		const groups = [];
		if (src.clsEquip) groups.push(...await CharactersDataUtil.parseStartingEquipment(src.clsEquip, src.clsName, "cls"));
		if (src.bgEquip) groups.push(...await CharactersDataUtil.parseStartingEquipment(src.bgEquip, src.bgName, "bg"));

		this._equipmentGroupsCache = {key, groups, goldAlternative: src.goldAlternative, clsName: src.clsName, bgName: src.bgName};
		return groups;
	}

	_renderStepEquipment () {
		const wrp = ee`<div class="ve-flex-col ve-w-100" style="max-width: 600px;"></div>`.appendTo(this._wrpStepContent);
		ee`<h4 class="ve-mt-0 ve-mb-2">Starting Equipment</h4>`.appendTo(wrp);

		if (!this._state.classes.some(it => it.ref) && !this._state.background) {
			ee`<div class="ve-muted ve-italic">Choose a class and background first to see starting equipment.</div>`.appendTo(wrp);
			return;
		}

		const wrpBody = ee`<div class="ve-flex-col ve-w-100"></div>`.appendTo(wrp);
		ee`<div class="ve-muted ve-italic">Loading\u2026</div>`.appendTo(wrpBody);

		this._pLoadEquipmentGroups()
			.then(groups => {
				wrpBody.empty();

				const cache = this._equipmentGroupsCache;

				if (!groups.length) {
					ee`<div class="ve-muted ve-italic">No structured starting equipment is available for your selections. You can add items manually later from the character sheet.</div>`.appendTo(wrpBody);
					return;
				}

				// Prune stale choices for blocks that no longer exist.
				const liveIds = new Set(groups.map(g => g.id));
				Object.keys(this._state.equipmentChoices).forEach(k => { if (!liveIds.has(k)) delete this._state.equipmentChoices[k]; });

				// region Gold alternative toggle (class only)
				if (cache.goldAlternative) {
					const wrpGold = ee`<div class="ve-char-builder__equip-gold ve-flex-v-center ve-w-100 ve-p-2 ve-mb-3"></div>`.appendTo(wrpBody);
					const cbGold = ee`<input type="checkbox" class="ve-mr-2" ${this._state.equipmentUseGold ? "checked" : ""}>`
						.onn("change", () => { this._state.equipmentUseGold = cbGold.checked; this._renderStep(); });
					ee`<label class="ve-flex-v-center ve-mb-0" style="cursor: pointer;">
						${cbGold}<span>Take starting gold instead of class equipment ${Renderer.get().render(cache.goldAlternative)}</span>
					</label>`.appendTo(wrpGold);
				}
				// endregion

				groups.forEach(group => {
					// Class equipment blocks are suppressed when the player opts for gold; background blocks remain.
					const isClassBlock = group.id.startsWith("cls-");
					if (isClassBlock && this._state.equipmentUseGold) return;
					this._renderEquipmentGroup(wrpBody, group);
				});

				// region Summary
				const summary = this._getResolvedEquipment();
				ee`<div class="ve-bold ve-mt-3 ve-mb-1">You will start with</div>`.appendTo(wrpBody);
				const wrpSummary = ee`<ul class="ve-pl-4 ve-mb-2"></ul>`.appendTo(wrpBody);
				if (!summary.items.length && !summary.totalCp) {
					ee`<li class="ve-muted ve-italic">Nothing selected yet.</li>`.appendTo(wrpSummary);
				} else {
					summary.items.forEach(it => {
						const qtyStr = it.quantity > 1 ? ` (\u00d7${it.quantity})` : "";
						const line = it.ref ? Renderer.get().render(`{@item ${it.name}|${it.source}}`) + qtyStr.qq() : `${it.name.qq()}${qtyStr.qq()}`;
						ee`<li>${line}</li>`.appendTo(wrpSummary);
					});
					if (summary.totalCp) {
						ee`<li>${this._formatCurrency(summary.totalCp).qq()}</li>`.appendTo(wrpSummary);
					}
				}
				if (summary.unresolved.length) {
					ee`<div class="ve-muted ve-italic ve-small">Note: ${summary.unresolved.length} entr${summary.unresolved.length === 1 ? "y" : "ies"} (e.g. category or special items) can't be added automatically and are skipped \u2014 add them manually later.</div>`.appendTo(wrpBody);
				}
				// endregion
			});
	}

	_renderEquipmentGroup (parent, group) {
		const wrpGroup = ee`<div class="ve-char-builder__class-row ve-flex-col ve-w-100 ve-p-3 ve-mb-2"></div>`.appendTo(parent);
		ee`<div class="ve-split-v-center ve-w-100 ve-mb-2">
			<span class="ve-bold">${(group.source || "Equipment").qq()}</span>
		</div>`.appendTo(wrpGroup);

		// Auto-granted fixed entries.
		if (group.fixed.length) {
			const wrpFixed = ee`<div class="ve-mb-2"></div>`.appendTo(wrpGroup);
			ee`<div class="ve-muted ve-small ve-mb-1">Granted:</div>`.appendTo(wrpFixed);
			ee`<div>${this._renderEquipmentEntryList(group.fixed)}</div>`.appendTo(wrpFixed);
		}

		// Mutually-exclusive options (radio).
		if (group.options.length) {
			// Default the choice to the first option if none chosen yet.
			if (this._state.equipmentChoices[group.id] == null) this._state.equipmentChoices[group.id] = group.options[0].key;
			const chosenKey = this._state.equipmentChoices[group.id];

			group.options.forEach(opt => {
				const isChecked = chosenKey === opt.key;
				const radio = ee`<input type="radio" name="equip-${group.id}" class="ve-mr-2" ${isChecked ? "checked" : ""}>`
					.onn("change", () => { this._state.equipmentChoices[group.id] = opt.key; this._renderStep(); });
				ee`<label class="ve-flex-top ve-mb-1 ve-w-100" style="cursor: pointer;">
					${radio}<span class="ve-flex-1">${this._renderEquipmentEntryList(opt.entries)}</span>
				</label>`.appendTo(wrpGroup);
			});
		}
	}

	/** Render a comma-joined human-readable list of normalized equipment entries (with item hovers). */
	_renderEquipmentEntryList (entries) {
		return entries
			.map(en => {
				const qtyStr = en.quantity > 1 ? ` (\u00d7${en.quantity})` : "";
				const coinStr = en.valueCp ? ` + ${this._formatCurrency(en.valueCp)}` : "";
				if (en.kind === "item" && en.ref) return `${Renderer.get().render(`{@item ${en.item.name}|${en.item.source}}`)}${qtyStr.qq()}${coinStr.qq()}`;
				if (en.kind === "value") return this._formatCurrency(en.valueCp).qq();
				return `${en.label.qq()}${qtyStr.qq()}`;
			})
			.join(", ");
	}

	/** Resolve the player's current equipment selections into concrete items + total currency. */
	_getResolvedEquipment () {
		const cache = this._equipmentGroupsCache;
		const out = {items: [], totalCp: 0, unresolved: []};
		if (!cache?.groups) return out;

		const addEntry = (en) => {
			if (en.valueCp) out.totalCp += en.valueCp * (en.quantity || 1);
			if (en.kind === "item" && en.ref) {
				out.items.push({ref: en.ref, name: en.item.name, source: en.item.source, quantity: en.quantity || 1});
			} else if (en.kind === "value") {
				// pure currency already added above
			} else {
				out.unresolved.push(en);
			}
		};

		cache.groups.forEach(group => {
			const isClassBlock = group.id.startsWith("cls-");
			if (isClassBlock && this._state.equipmentUseGold) return;

			group.fixed.forEach(addEntry);

			if (group.options.length) {
				const chosenKey = this._state.equipmentChoices[group.id] ?? group.options[0].key;
				const opt = group.options.find(o => o.key === chosenKey) || group.options[0];
				opt.entries.forEach(addEntry);
			}
		});

		// If gold alternative is taken, roll-free we just note it; actual gold isn't auto-added (it's a dice expression).
		return out;
	}

	_formatCurrency (cp) {
		cp = Math.max(0, Math.floor(cp || 0));
		const gp = Math.floor(cp / 100);
		const sp = Math.floor((cp % 100) / 10);
		const rem = cp % 10;
		const parts = [];
		if (gp) parts.push(`${gp} gp`);
		if (sp) parts.push(`${sp} sp`);
		if (rem) parts.push(`${rem} cp`);
		return parts.length ? parts.join(", ") : "0 gp";
	}

	/* -------------------------------------------- Feats -------------------------------------------- */

	_renderStepFeats () {
		const wrp = ee`<div class="ve-flex-col ve-w-100"></div>`.appendTo(this._wrpStepContent);
		ee`<h4 class="ve-mt-0 ve-mb-2">Feats</h4>`.appendTo(wrp);
		ee`<div class="ve-muted ve-mb-3">Add any feats your character has (optional).</div>`.appendTo(wrp);

		const byHash = {};
		this._dataFeats.forEach(ft => { byHash[UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_FEATS](ft)] = ft; });

		const wrpList = ee`<div class="ve-flex-col ve-char__gap-1 ve-w-100 ve-mb-3" style="max-width: 480px;"></div>`.appendTo(wrp);

		const doRenderList = () => {
			wrpList.empty();
			if (!this._state.feats.length) {
				ee`<div class="ve-muted ve-italic">No feats added.</div>`.appendTo(wrpList);
				return;
			}
			this._state.feats.forEach((ref, ix) => {
				const ft = byHash[ref.hash];
				const name = ft ? CharactersDataUtil.getDisplayWithSource(ft) : ref.hash;
				const btnDel = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>`
					.onn("click", () => { this._state.feats.splice(ix, 1); doRenderList(); });
				ee`<div class="ve-split-v-center ve-char-builder__feat-row ve-px-2 ve-py-1">
					<span>${name.qq()}</span>${btnDel}
				</div>`.appendTo(wrpList);
			});
		};

		const comp = BaseComponent.fromObject({sel: null});
		const sel = ComponentUiUtil.getSelSearchable(
			comp,
			"sel",
			{
				values: this._dataFeats.map(ft => UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_FEATS](ft)),
				isAllowNull: true,
				displayNullAs: "Search feats to add\u2026",
				fnDisplay: (hash) => hash == null ? "Search feats to add\u2026" : CharactersDataUtil.getDisplayWithSource(byHash[hash]),
			},
		);
		comp._addHookBase("sel", () => {
			const hash = comp._state.sel;
			if (hash == null) return;
			if (!this._state.feats.some(it => it.hash === hash && it.source === byHash[hash].source)) {
				this._state.feats.push({page: UrlUtil.PG_FEATS, source: byHash[hash].source, hash});
				doRenderList();
			}
			comp._state.sel = null;
		});

		ee`<label class="ve-flex-col ve-w-100 ve-mb-3" style="max-width: 480px;">
			<span class="ve-muted ve-mb-1">Add feat</span>
			${sel}
		</label>`.appendTo(wrp);

		wrpList.appendTo(wrp);
		doRenderList();
	}

	/* -------------------------------------------- Review -------------------------------------------- */

	_renderStepReview () {
		const wrp = ee`<div class="ve-flex-col ve-w-100" style="max-width: 560px;"></div>`.appendTo(this._wrpStepContent);
		ee`<h4 class="ve-mt-0 ve-mb-2">Review</h4>`.appendTo(wrp);

		const iptName = ee`<input type="text" class="form-control" value="${(this._state.name || "").qq()}">`
			.onn("change", () => { this._state.name = iptName.value.trim() || "New Character"; });
		ee`<label class="ve-flex-col ve-mb-3">
			<span class="ve-muted ve-mb-1">Character Name</span>
			${iptName}
		</label>`.appendTo(wrp);

		const addRow = (label, value) => {
			ee`<div class="ve-split-v-center ve-w-100 ve-py-1 ve-char-builder__review-row">
				<span class="ve-muted">${label.qq()}</span><span class="ve-text-right">${value}</span>
			</div>`.appendTo(wrp);
		};

		const raceName = this._getRefName(this._dataRaces, UrlUtil.PG_RACES, this._state.race) || "\u2014";
		addRow("Race", raceName.qq());

		const classSummary = this._state.classes
			.filter(it => it.ref)
			.map(it => {
				const cls = this._findByHash(this._dataClasses, UrlUtil.PG_CLASSES, it.ref.hash);
				let str = `${cls ? cls.name : it.ref.hash} ${it.level}`;
				if (it.subclass && cls) {
					const sc = (cls.subclasses || []).find(s => UrlUtil.URL_TO_HASH_BUILDER["subclass"](s) === it.subclass.hash);
					if (sc) str += ` (${sc.name})`;
				}
				return str;
			})
			.join(", ") || "\u2014";
		addRow("Classes", classSummary.qq());

		const bgName = this._getRefName(this._dataBackgrounds, UrlUtil.PG_BACKGROUNDS, this._state.background) || "\u2014";
		addRow("Background", bgName.qq());

		const abilityScores = this._getFinalAbilityScores();
		const abStr = CharacterModel.ABILITIES
			.map(ab => `${ab.toUpperCase()} ${abilityScores[ab]}`)
			.join(" \u2022 ");
		addRow("Ability Scores", abStr.qq());

		const resolvedProf = this._getResolvedProficiencies();
		const savesStr = resolvedProf.saves.length
			? resolvedProf.saves.map(s => s.toUpperCase()).join(", ")
			: "\u2014";
		addRow("Saving Throws", savesStr.qq());

		const skillsStr = resolvedProf.skills.length
			? resolvedProf.skills.map(s => this._titleCaseSkill(s)).sort(SortUtil.ascSortLower).join(", ")
			: "\u2014";
		addRow("Skills", skillsStr.qq());

		const featNames = this._state.feats
			.map(ref => { const ft = this._findByHash(this._dataFeats, UrlUtil.PG_FEATS, ref.hash); return ft ? ft.name : ref.hash; })
			.join(", ") || "\u2014";
		addRow("Feats", featNames.qq());

		// Equipment summary (best-effort; uses the cache populated when the Equipment step was viewed).
		if (!this._isEdit) {
			const wrpEquip = ee`<div class="ve-split-v-center ve-w-100 ve-py-1 ve-char-builder__review-row">
				<span class="ve-muted">Equipment</span><span class="ve-text-right ve-muted ve-italic">Loading\u2026</span>
			</div>`.appendTo(wrp);
			this._pLoadEquipmentGroups().then(() => {
				const equip = this._getResolvedEquipment();
				const parts = equip.items.map(it => `${it.name}${it.quantity > 1 ? ` (\u00d7${it.quantity})` : ""}`);
				if (equip.totalCp) parts.push(this._formatCurrency(equip.totalCp));
				const str = parts.length ? parts.join(", ") : "\u2014";
				wrpEquip.empty();
				ee`<span class="ve-muted">Equipment</span>`.appendTo(wrpEquip);
				ee`<span class="ve-text-right">${str.qq()}</span>`.appendTo(wrpEquip);
			});
		}

		ee`<div class="ve-muted ve-italic ve-mt-3">Click "${this._isEdit ? "Save" : "Create"} Character" to finish. You can edit details later from the character sheet.</div>`.appendTo(wrp);
	}

	/* -------------------------------------------- Helpers / output -------------------------------------------- */

	_findByHash (entities, page, hash) {
		if (hash == null) return null;
		return entities.find(ent => UrlUtil.URL_TO_HASH_BUILDER[page](ent) === hash) || null;
	}

	_getRefName (entities, page, ref) {
		if (!ref) return null;
		const ent = this._findByHash(entities, page, ref.hash);
		return ent ? ent.name : ref.hash;
	}

	_getFinalAbilityScores () {
		switch (this._state.abilityMode) {
			case "standard": {
				const out = {};
				CharacterModel.ABILITIES.forEach(ab => { out[ab] = this._state.standardAssign[ab] ?? 10; });
				return out;
			}
			case "pointbuy":
			case "manual":
			default:
				return {...this._state.abilityScores};
		}
	}

	getCharacter () {
		const base = this._isEdit ? this._baseCharacter : CharacterModel.getNewCharacter({name: this._state.name});

		base.name = this._state.name || "New Character";

		base.race = this._state.race
			? {...this._state.race, _displayName: this._getRefName(this._dataRaces, UrlUtil.PG_RACES, this._state.race)}
			: null;

		base.background = this._state.background
			? {...this._state.background, _displayName: this._getRefName(this._dataBackgrounds, UrlUtil.PG_BACKGROUNDS, this._state.background)}
			: null;

		base.feats = this._state.feats.map(ref => ({
			...ref,
			_displayName: this._getRefName(this._dataFeats, UrlUtil.PG_FEATS, ref),
		}));

		base.classes = this._state.classes
			.filter(it => it.ref)
			.map(it => {
				const cls = this._findByHash(this._dataClasses, UrlUtil.PG_CLASSES, it.ref.hash);
				let displayName = cls ? cls.name : it.ref.hash;
				if (it.subclass && cls) {
					const sc = (cls.subclasses || []).find(s => UrlUtil.URL_TO_HASH_BUILDER["subclass"](s) === it.subclass.hash);
					if (sc) displayName += ` (${sc.name})`;
				}
				return {
					page: it.ref.page,
					source: it.ref.source,
					hash: it.ref.hash,
					level: it.level || 1,
					subclass: it.subclass || null,
					_displayName: displayName,
				};
			});

		base.abilities = this._getFinalAbilityScores();

		// Proficiencies (saves/skills/armor/weapons/tools) + hit dice, derived from selections.
		const prof = this._getResolvedProficiencies();
		base.proficiencies = base.proficiencies || {};
		base.proficiencies.saves = prof.saves;
		base.proficiencies.skills = prof.skills;
		base.proficiencies.armor = prof.armor;
		base.proficiencies.weapons = prof.weapons;
		base.proficiencies.tools = prof.tools;
		base.proficiencies.skillsExpertise = base.proficiencies.skillsExpertise || [];
		base.proficiencies.languages = base.proficiencies.languages || [];

		base.hitDice = prof.hitDice;

		// Starting equipment -> inventory + currency. Only applied on initial creation; when editing
		// we leave the existing inventory untouched so manual edits aren't clobbered.
		if (!this._isEdit) {
			const equip = this._getResolvedEquipment();

			const inventory = [];
			equip.items.forEach(it => {
				const key = `${it.ref.page}|${it.ref.source}|${it.ref.hash}`;
				const existing = inventory.find(e => `${e.page}|${e.source}|${e.hash}` === key);
				if (existing) existing.quantity += it.quantity;
				else inventory.push({page: it.ref.page, source: it.ref.source, hash: it.ref.hash, quantity: it.quantity, equipped: false, attuned: false});
			});
			base.inventory = inventory;

			// Convert total copper into the currency buckets (largest-first).
			base.currency = base.currency || {pp: 0, gp: 0, ep: 0, sp: 0, cp: 0};
			let cp = Math.max(0, Math.floor(equip.totalCp || 0));
			base.currency.gp = (base.currency.gp || 0) + Math.floor(cp / 100); cp %= 100;
			base.currency.sp = (base.currency.sp || 0) + Math.floor(cp / 10); cp %= 10;
			base.currency.cp = (base.currency.cp || 0) + cp;
		}

		// Persist builder-only choice state so editing re-opens with the same selections.
		base._builder = {
			skillChoices: MiscUtil.copyFast(this._state.skillChoices),
			toolChoices: MiscUtil.copyFast(this._state.toolChoices),
			equipmentChoices: MiscUtil.copyFast(this._state.equipmentChoices),
			equipmentUseGold: this._state.equipmentUseGold,
		};

		CharacterModel.migrate(base);
		return base;
	}

	async _doFinish () {
		if (!this._state.classes.some(it => it.ref)) {
			JqueryUtil.doToast({type: "warning", content: "Add at least one class before finishing."});
			this._goToStep(CharacterBuilder._STEPS.findIndex(s => s.id === "class"));
			return;
		}
		// Ensure starting-equipment groups are parsed even if the user never opened that step,
		// so `getCharacter` can populate the inventory/currency.
		if (!this._isEdit) await this._pLoadEquipmentGroups();
		this._isResolved = true;
		const character = this.getCharacter();
		this._resolve(character);
		this._modal.doClose(true);
	}
}

globalThis.CharacterBuilder = CharacterBuilder;
