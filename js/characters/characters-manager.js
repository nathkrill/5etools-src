import {CharacterModel} from "./characters-model.js";
import {CharactersStorage} from "./characters-storage.js";
import {CharacterBuilder} from "./characters-builder.js";

/**
 * The "character list" landing view: create / import / export / delete characters,
 * and open one for editing/play.
 *
 * Rendered into a container element. Calls `opts.fnOpenCharacter(characterId)` when the
 * user opens a character.
 */
export class CharactersManager {
	constructor ({fnGetCharacters, fnAddCharacters, fnDeleteCharacter, fnOnChange, fnOpenCharacter}) {
		// Read the live characters array from the page on demand, rather than caching a
		// reference (which desyncs if the page ever reassigns its array).
		this._fnGetCharacters = fnGetCharacters;
		this._fnAddCharacters = fnAddCharacters;
		this._fnDeleteCharacter = fnDeleteCharacter;
		this._fnOnChange = fnOnChange;
		this._fnOpenCharacter = fnOpenCharacter;

		this._wrp = null;
		this._wrpList = null;
	}

	get _characters () { return this._fnGetCharacters(); }

	render (parent) {
		this._wrp = ee`<div class="ve-char ve-flex-col ve-h-100 ve-w-100 ve-overflow-y-auto"></div>`;

		const btnNew = ee`<button class="ve-btn ve-btn-primary"><span class="glyphicon glyphicon-plus"></span> New Character</button>`
			.onn("click", () => this._pHandleClickNew());

		const btnImport = ee`<button class="ve-btn ve-btn-default" title="Import character(s) from a JSON file"><span class="glyphicon glyphicon-upload"></span> Import</button>`
			.onn("click", () => this._pHandleClickImport());

		const btnExportAll = ee`<button class="ve-btn ve-btn-default" title="Export all characters to a JSON file"><span class="glyphicon glyphicon-download"></span> Export All</button>`
			.onn("click", () => this._handleClickExportAll());

		const wrpControls = ee`<div class="ve-flex-v-center ve-flex-wrap ve-char__gap-2 ve-mb-3">
			${btnNew}${btnImport}${btnExportAll}
		</div>`;

		this._wrpList = ee`<div class="ve-char-mgr__wrp ve-flex-col"></div>`;

		ee`<div class="ve-flex-col ve-w-100 ve-px-4 ve-py-3">
			<h4 class="ve-mt-0 ve-mb-2">Your Characters</h4>
			${wrpControls}
			${this._wrpList}
		</div>`.appendTo(this._wrp);

		parent.empty();
		this._wrp.appendTo(parent);

		this._renderList();
	}

	_renderList () {
		this._wrpList.empty();

		if (!this._characters.length) {
			ee`<div class="ve-muted ve-italic ve-py-3">No characters yet. Click <b>New Character</b> to create one.</div>`
				.appendTo(this._wrpList);
			return;
		}

		this._characters
			.slice()
			.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0))
			.forEach(character => this._renderListRow(character));
	}

	_renderListRow (character) {
		const totalLevel = CharacterModel.getTotalLevel(character);
		const metaParts = [];
		if (totalLevel) metaParts.push(`Level ${totalLevel}`);
		const classStr = (character.classes || [])
			.map(it => it._displayName || (it.hash ? it.hash.split("_")[0].toTitleCase() : null))
			.filter(Boolean)
			.join(" / ");
		if (classStr) metaParts.push(classStr);

		const btnExport = ee`<button class="ve-btn ve-btn-xs ve-btn-default" title="Export"><span class="glyphicon glyphicon-download"></span></button>`
			.onn("click", evt => {
				evt.stopPropagation();
				CharactersStorage.downloadCharacter(character);
			});

		const btnDuplicate = ee`<button class="ve-btn ve-btn-xs ve-btn-default" title="Duplicate"><span class="glyphicon glyphicon-duplicate"></span></button>`
			.onn("click", evt => {
				evt.stopPropagation();
				this._handleClickDuplicate(character);
			});

		const btnDelete = ee`<button class="ve-btn ve-btn-xs ve-btn-danger" title="Delete"><span class="glyphicon glyphicon-trash"></span></button>`
			.onn("click", evt => {
				evt.stopPropagation();
				this._pHandleClickDelete(character);
			});

		ee`<div class="ve-char-mgr__row ve-split-v-center">
			<div class="ve-flex-col ve-min-w-0">
				<div class="ve-char-mgr__name ve-text-clip-ellipsis">${(character.name || "Unnamed").qq()}</div>
				<div class="ve-char-mgr__meta">${metaParts.join(" \u2014 ").qq() || "Empty character"}</div>
			</div>
			<div class="ve-flex-v-center ve-char__gap-1 ve-no-shrink">${btnExport}${btnDuplicate}${btnDelete}</div>
		</div>`
			.onn("click", () => this._fnOpenCharacter(character.id))
			.appendTo(this._wrpList);
	}

	async _pHandleClickNew () {
		const builder = new CharacterBuilder();
		const character = await builder.pOpen();
		if (!character) return;

		this._fnAddCharacters([character]);
		this._fnOnChange();
		this._renderList();
		this._fnOpenCharacter(character.id);
	}

	async _pHandleClickImport () {
		const imported = await CharactersStorage.pUploadCharacters();
		if (!imported.length) return;

		this._fnAddCharacters(imported);
		this._fnOnChange();
		this._renderList();

		JqueryUtil.doToast({type: "success", content: `Imported ${imported.length} character${imported.length === 1 ? "" : "s"}.`});
	}

	_handleClickExportAll () {
		if (!this._characters.length) return JqueryUtil.doToast({type: "warning", content: "No characters to export."});
		CharactersStorage.downloadAll(this._characters);
	}

	_handleClickDuplicate (character) {
		const cpy = MiscUtil.copyFast(character);
		cpy.id = CryptUtil.uid();
		cpy.name = `${cpy.name || "Character"} (Copy)`;
		cpy.dateCreated = cpy.dateModified = Date.now();
		this._fnAddCharacters([cpy]);
		this._fnOnChange();
		this._renderList();
	}

	async _pHandleClickDelete (character) {
		const isOk = await InputUiUtil.pGetUserBoolean({
			title: "Delete Character",
			htmlDescription: `Are you sure you want to delete <b>${(character.name || "this character").qq()}</b>? This cannot be undone.`,
			textYes: "Delete",
			textNo: "Cancel",
		});
		if (!isOk) return;

		this._fnDeleteCharacter(character.id);
		this._fnOnChange();
		this._renderList();
	}
}

globalThis.CharactersManager = CharactersManager;
