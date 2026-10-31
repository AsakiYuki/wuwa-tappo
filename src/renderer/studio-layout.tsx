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
            <button
              data-window="smaller"
              title="Shrink Window"
              aria-label="Shrink Window"
            >
              −
            </button>
            <button
              data-window="larger"
              title="Enlarge Window"
              aria-label="Enlarge Window"
            >
              ＋
            </button>
            <button
              data-window="minimize"
              title="Minimize"
              aria-label="Minimize"
            >
              ▁
            </button>
            <button
              data-window="maximize"
              title="Maximize / Restore"
              aria-label="Maximize or Restore"
            >
              □
            </button>
          </div>
          <button
            id="closePanel"
            className="panel-close"
            title="Close Panel"
          ></button>
          <section
            id="page-collection"
            className="page module-block role-panel"
          >
            <div className="panel-content">
              <div className="preset-content" id="currentOutfit">
                <div className="preset-preview">
                  <div className="preset-preview-main">
                    <div className="preset-preview-img-box">
                      <div className="offline-preview">
                        <img id="heroHead" />
                        <img id="heroBody" />
                        <img id="heroAccessory" />
                      </div>
                    </div>
                    <div id="previewEmotes"></div>
                  </div>
                </div>
                <div className="my-preset">
                  <div className="my-preset-title">My Presets</div>
                  <div className="my-preset-list" id="miniPresets"></div>
                </div>
              </div>
              <div className="atlas-tab" id="typeTabs">
                <button
                  className="atlas-tab-item selected"
                  data-type="all"
                  id="allTab"
                >
                  Recent
                </button>
                <button className="atlas-tab-item" data-type="character">
                  Characters
                </button>
                <button className="atlas-tab-item" data-type="accessory">
                  Accessories
                </button>
                <button className="atlas-tab-item" data-type="emote">
                  Emotes
                </button>
              </div>
              <div id="filterBar" className="atlas-select"></div>
              <div id="replaceBar" hidden>
                <span id="replaceHint"></span>
                <button id="cancelReplace" className="setting-btn">
                  Cancel
                </button>
              </div>
              <div className="atlas-content">
                <div
                  id="inventory"
                  className="atlas-section common-scrollbar2"
                ></div>
              </div>
            </div>
          </section>
          <section id="page-draw" hidden className="page module-block">
            <div className="panel-content draw-content">
              <div className="draw-banner">
                <img
                  className="chest-art"
                  src="../assets/ui/chest-base-gold-BKP4rDVz.png"
                />
                <h2>Open Chests</h2>
                <p>Characters, Accessories, Emotes · Unlimited Draws</p>
                <div className="draw-buttons">
                  <button className="common-btn" data-draw="1">
                    Draw 1 ∞
                  </button>
                  <button className="common-btn" data-draw="10">
                    Draw 10 ∞
                  </button>
                </div>
                <p id="pity"></p>
              </div>
              <p className="rules">
                Local rates: Common 65% · Uncommon 25% · Rare 9% · Epic 1%.
                Guaranteed Uncommon+ in 10-pull, Epic within 50 pulls.
              </p>
              <div className="section-title">
                <h3>Recent Pulls</h3>
                <span id="drawTotal"></span>
              </div>
              <div id="history" className="history"></div>
            </div>
          </section>
          <section
            id="page-synthesis"
            hidden
            className="page module-block synthesis-panel"
          >
            <div className="panel-content">
              <div className="atlas-tab">
                <button
                  className="atlas-tab-item selected"
                  data-synth-mode="upgrade"
                >
                  Upgrade Synthesis
                </button>
                <button className="atlas-tab-item" data-synth-mode="same">
                  Same-tier Synthesis
                </button>
              </div>
              <div className="synthesis-main">
                <div className="synthesis-success" id="synthesisCircle"></div>
                <div className="synthesis-list" id="synthesisSlots"></div>
                <div className="synthesis-tip" id="synthesisTip"></div>
                <div className="synthesis-btns">
                  <button className="common-btn" id="autoSelect">
                    Auto Select
                  </button>
                  <button className="common-btn" data-synth-count="1" disabled>
                    Synthesize 1
                  </button>
                  <button className="common-btn" data-synth-count="10" disabled>
                    Synthesize 10
                  </button>
                </div>
                <p id="synthesisSelected" className="synthesis-selected"></p>
              </div>
            </div>
          </section>
          <section id="page-presets" hidden className="page module-block">
            <div className="panel-content">
              <div className="save-preset">
                <input
                  id="presetName"
                  maxLength={24}
                  placeholder="Preset Name"
                />
                <button className="common-btn" id="savePreset">
                  Save Current Outfit
                </button>
              </div>
              <div id="presets" className="presets"></div>
            </div>
          </section>
          <section
            id="page-settings"
            hidden
            className="page module-block settings-module"
          >
            <div className="panel-content">
              <div id="settingsRows"></div>
              <div className="setting-btns">
                <button className="common-btn" id="openFolder">
                  Open Save Folder
                </button>
                <div className="setting-btns-right">
                  <button className="common-btn" id="recenter">
                    Recenter Pet
                  </button>
                  <button className="common-btn" id="quit">
                    Quit App
                  </button>
                </div>
              </div>
              <div className="setting-copyright">
                Wuwa Tappo
                <span id="hookStatus"></span>
              </div>
            </div>
          </section>
        </main>
      </div>
      <div id="toast" role="status"></div>
      <dialog id="results">
        <button
          className="popup-close"
          id="closeResults"
          title="Close"
        ></button>
        <h2 id="resultTitle">Items Obtained</h2>
        <div id="resultGrid" className="result-grid"></div>
        <div className="result-footer">
          <p>Saved to inventory</p>
          <button className="common-btn" id="drawAgain">
            Draw 10 Again ∞
          </button>
        </div>
      </dialog>
      <dialog id="materialPicker">
        <button className="popup-close" id="closeMaterials"></button>
        <h2>Select Synthesis Materials</h2>
        <div id="materialGroups"></div>
        <p>
          Only duplicate copies will be consumed. The last copy is always kept.
        </p>
      </dialog>
      <dialog id="emotePicker">
        <button
          className="popup-close"
          id="closeEmotePicker"
          title="Cancel"
        ></button>
        <h2 id="emotePickerTitle">Replace Which Emote?</h2>
        <p className="emote-picker-tip" id="emotePickerTip">
          Click a slot below to equip the selected emote.
        </p>
        <div id="emoteSlots"></div>
      </dialog>
      <div id="resizeHandles"></div>
    </>
  );
}
