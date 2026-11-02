export function StudioLayout() {
	return (
		<>
			<div id="replicaRoot" className="module-panel">
				<nav className="tab-bar">
					<div className="tab-logo"></div>
					<button className="tab-btn tab-btn--active" data-page="collection">
						<i className="tab-btn__icon tab-btn__icon--bag"></i>
						<span className="tab-btn__label">Bag</span>
					</button>
					<button className="tab-btn" data-page="atlas">
						<i className="tab-btn__icon tab-btn__icon--atlas"></i>
						<span className="tab-btn__label">Atlas</span>
					</button>
					<button className="tab-btn" data-page="synthesis">
						<i className="tab-btn__icon tab-btn__icon--exchange"></i>
						<span className="tab-btn__label">Synthesis</span>
					</button>
					<button className="tab-btn" data-page="draw">
						<i className="tab-btn__icon tab-btn__icon--room"></i>
						<span className="tab-btn__label">Chests</span>
					</button>
					<button className="tab-btn" data-page="settings">
						<i className="tab-btn__icon tab-btn__icon--setting"></i>
						<span className="tab-btn__label">Settings</span>
					</button>
					<button id="hidePanel" className="tab-btn">
						<i className="tab-btn__icon tab-btn__icon--toggle"></i>
						<span className="tab-btn__label">Hide</span>
					</button>
				</nav>
				<main className="module-content">
					<div className="module-content__bg"></div>
					<div className="panel-drag" id="panelDrag"></div>
					<div className="window-actions">
						<button data-window="smaller" title="Shrink Window" aria-label="Shrink Window">
							−
						</button>
						<button data-window="larger" title="Enlarge Window" aria-label="Enlarge Window">
							＋
						</button>
						<button data-window="minimize" title="Minimize" aria-label="Minimize">
							▁
						</button>
						<button data-window="maximize" title="Maximize / Restore" aria-label="Maximize or Restore">
							□
						</button>
					</div>
					<button id="closePanel" className="panel-close" title="Close Panel"></button>
					<section id="page-collection" className="page module-block role-panel">
						<div className="panel-content">
							<div className="preset-content" id="currentOutfit"></div>
							<div id="typeTabs"></div>
							<div id="filterBar" className="atlas-select"></div>
							<div id="replaceBar" hidden>
								<span id="replaceHint"></span>
								<button id="cancelReplace" className="setting-btn">
									Cancel
								</button>
							</div>
							<div className="atlas-content">
								<div id="inventory" className="atlas-section common-scrollbar2">
									<div id="inventoryRoot"></div>
								</div>
							</div>
						</div>
					</section>
					<section id="page-draw" hidden className="page module-block">
						<div className="panel-content draw-content">
							<div className="draw-banner">
								<img className="chest-art" src="../assets/ui/chest/base-gold.png" />
								<h2>Open Chests</h2>
								<p>Characters, Accessories, Emotes · Unlimited Draws</p>
								<div id="drawButtonsRoot"></div>
								<p id="pity"></p>
							</div>
							<p className="rules">
								Local rates: Common 65% · Uncommon 25% · Rare 9% · Epic 1%. Guaranteed Uncommon+ in 10-pull, Epic within
								50 pulls.
							</p>
							<div className="section-title">
								<h3>Recent Pulls</h3>
								<span id="drawTotal"></span>
							</div>
							<div id="history" className="history"></div>
						</div>
					</section>
					<section id="page-synthesis" hidden className="page module-block synthesis-panel">
						<div id="synthesisRoot"></div>
					</section>
					<section id="page-presets" hidden className="page module-block">
						<div id="presetsRoot"></div>
					</section>
					<section id="page-settings" hidden className="page module-block settings-module">
						<div className="panel-content">
							<div id="settingsRows"></div>
							<div className="setting-copyright">
								<span>Wuwa Tappo</span>
								<span id="appVersion"></span>
								<span id="buildVersion"></span>
								<span id="hookStatus"></span>
							</div>
						</div>
					</section>
					<section id="page-keyboard-labels" hidden className="page module-block settings-module">
						<div className="panel-content">
							<div className="settings-subpage-header">
								<button className="common-btn settings-back-button" id="backToSettings">
									← Settings
								</button>
								<h2>Keyboard Labels</h2>
							</div>
							<div id="keyboardLabelsRows"></div>
						</div>
					</section>
				</main>
			</div>
			<div id="toast" role="status"></div>
			<div id="resultDialogRoot"></div>
			<dialog id="results"></dialog>
			<dialog id="materialPicker"></dialog>
			<dialog id="emotePicker">
				<button className="popup-close" id="closeEmotePicker" title="Cancel"></button>
				<h2 id="emotePickerTitle">Replace Which Emote?</h2>
				<p className="emote-picker-tip" id="emotePickerTip">
					Click a slot below to equip the selected emote.
				</p>
				<div id="emoteSlots"></div>
			</dialog>
			<div id="resizeHandles"></div>
		</>
	)
}
