<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue"
import { capturedKeyName } from "../../lib/key-capture"
import { keyLabelMode, navigate, state, updateSettings } from "../../store"
import { toast } from "../../toast"

defineProps<{ visible: boolean }>()

interface LabelRow {
	id: string
	key: string
	value: string
}

const toRows = (labels: Record<string, string>): LabelRow[] =>
	Object.entries(labels).map(([key, value], index) => ({ id: `${key}-${index}`, key, value }))

const rows = ref<LabelRow[]>([])
const jsonDraft = ref("")
const capturing = ref(false)

watch(
	() => state.value?.settings.keyLabels,
	labels => {
		if (!labels) return
		rows.value = toRows(labels)
		jsonDraft.value = JSON.stringify(labels, null, 2)
	},
	{ immediate: true },
)

function saveRows() {
	const keyLabels: Record<string, string> = {}
	for (const row of rows.value) {
		const key = row.key.trim()
		if (key) keyLabels[key] = row.value.trim() || key
	}
	void updateSettings({ keyLabels })
}

function removeRow(id: string) {
	rows.value = rows.value.filter(row => row.id !== id)
	saveRows()
}

async function focusValue(row: LabelRow, select = false) {
	await nextTick()
	const input = document.getElementById(`key-label-value-${row.id}`) as HTMLInputElement | null
	input?.focus()
	if (select) input?.select()
}

/** New rows stay local until a field is blurred, so the user can type the label first. */
function addCapturedKey(key: string) {
	capturing.value = false
	const existing = rows.value.find(row => row.key === key)
	if (existing) {
		toast(`${key} already has a label`)
		void focusValue(existing)
		return
	}
	const row = { id: `${key}-${rows.value.length}`, key, value: key }
	rows.value = [...rows.value, row]
	void focusValue(row, true)
}

function onCaptureKey(event: KeyboardEvent) {
	event.preventDefault()
	event.stopPropagation()
	if (event.key === "Escape") {
		capturing.value = false
		return
	}
	const key = capturedKeyName(event)
	if (key && key !== "Unidentified") addCapturedKey(key)
}

watch(capturing, active => {
	if (active) window.addEventListener("keydown", onCaptureKey, true)
	else window.removeEventListener("keydown", onCaptureKey, true)
})
onBeforeUnmount(() => window.removeEventListener("keydown", onCaptureKey, true))

function saveJson() {
	try {
		const parsed: unknown = JSON.parse(jsonDraft.value || "{}")
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not an object")
		void updateSettings({ keyLabels: parsed as Record<string, string> })
	} catch {
		toast('Use valid JSON like {"Meta":"Meta"}')
	}
}
</script>

<template>
	<section id="page-keyboard-labels" class="page module-block settings-module" :hidden="!visible">
		<div class="panel-content">
			<div class="settings-subpage-header">
				<button id="backToSettings" class="common-btn settings-back-button" @click="navigate('settings')">
					← Settings
				</button>
				<h2>Keyboard Labels</h2>
			</div>
			<div id="keyboardLabelsRows">
				<div class="keyboard-labels-editor">
					<div class="keyboard-label-mode">
						<button
							v-for="mode in ['ui', 'json'] as const"
							:key="mode"
							:class="{ active: keyLabelMode === mode }"
							type="button"
							:aria-pressed="keyLabelMode === mode"
							@click="keyLabelMode = mode"
						>
							{{ mode.toUpperCase() }}
						</button>
					</div>
					<div class="keyboard-label-ui" :hidden="keyLabelMode !== 'ui'">
						<div class="setting-sub">Edit each key and its displayed label.</div>
						<div class="keyboard-label-rows">
							<div v-for="row in rows" :key="row.id" class="keyboard-label-row">
								<input
									v-model="row.key"
									class="keyboard-label-input"
									aria-label="Key name"
									data-label-field="key"
									placeholder="Key name, e.g. Meta"
									@blur="saveRows"
								/>
								<input
									:id="`key-label-value-${row.id}`"
									v-model="row.value"
									class="keyboard-label-input"
									aria-label="Displayed label"
									data-label-field="value"
									placeholder="Displayed label"
									@blur="saveRows"
								/>
								<button
									class="common-btn keyboard-label-remove"
									:aria-label="`Remove ${row.key || 'key label'}`"
									type="button"
									@click="removeRow(row.id)"
								>
									Remove
								</button>
							</div>
						</div>
						<div class="keyboard-label-add-actions">
							<button class="common-btn keyboard-label-add" type="button" @click="capturing = true">
								{{ capturing ? "Press a key..." : "Add Key" }}
							</button>
							<button
								v-if="capturing"
								class="common-btn keyboard-label-cancel"
								type="button"
								@click="capturing = false"
							>
								Cancel
							</button>
						</div>
					</div>
					<div class="keyboard-label-json" :hidden="keyLabelMode !== 'json'">
						<div class="setting-sub">Edit key labels as JSON, for example: {"Meta":"Meta"}.</div>
						<textarea
							v-model="jsonDraft"
							class="setting-textarea"
							aria-label="Keyboard Labels JSON"
							rows="12"
							@blur="saveJson"
						/>
					</div>
				</div>
			</div>
		</div>
	</section>
</template>
