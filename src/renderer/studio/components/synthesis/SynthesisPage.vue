<script setup lang="ts">
import { computed, ref } from "vue"
import { assetPath } from "../../../shared/assets"
import type { HistoryEntry, SynthesisMode } from "../../../shared/types"
import { getSynthesisGroups, pickSynthesisMaterials, type SynthesisGroup } from "../../lib/collection"
import { RARITY_LABELS, TYPE_LABELS } from "../../lib/constants"
import { command, items, showResults, state } from "../../store"
import { toast } from "../../toast"
import ModalDialog from "../ModalDialog.vue"

defineProps<{ visible: boolean }>()

/** Copies consumed per synthesis: same-tier needs 5, upgrading needs 10. */
const COST: Record<SynthesisMode, number> = { same: 5, upgrade: 10 }
const modes: Array<{ value: SynthesisMode; label: string }> = [
	{ value: "upgrade", label: "Upgrade Synthesis" },
	{ value: "same", label: "Same-tier Synthesis" },
]

const mode = ref<SynthesisMode>("upgrade")
const selectedKey = ref<string | null>(null)
const materialsOpen = ref(false)
const working = ref(false)

const cost = computed(() => COST[mode.value])
const groups = computed(() => (state.value ? getSynthesisGroups(items.value, state.value, mode.value) : []))
const selectedGroup = computed(() => groups.value.find(group => group.key === selectedKey.value) ?? null)
const materials = computed(() =>
	selectedGroup.value ? pickSynthesisMaterials(selectedGroup.value, state.value, cost.value) : [],
)
const slots = computed(() => Array.from({ length: cost.value }, (_, index) => materials.value[index]))

function setMode(next: SynthesisMode) {
	mode.value = next
	selectedKey.value = null
}

function chooseGroup(group: SynthesisGroup) {
	selectedKey.value = group.key
	materialsOpen.value = false
}

function autoSelect() {
	const group = groups.value.find(candidate => candidate.count >= cost.value)
	selectedKey.value = group?.key ?? null
	if (!group) toast("Not enough duplicate items for synthesis")
}

async function synthesize(count: 1 | 10) {
	const group = selectedGroup.value
	if (working.value || !group) return
	working.value = true
	try {
		const result = await command<HistoryEntry[]>("synthesize", {
			n: count,
			rarity: group.rarity,
			type: group.type,
			mode: mode.value,
		})
		if (result.ok) showResults({ results: result.result, source: "synthesis" })
	} finally {
		working.value = false
	}
}
</script>

<template>
	<section id="page-synthesis" class="page module-block synthesis-panel" :hidden="!visible">
		<div id="synthesisRoot">
			<div class="panel-content">
				<div class="atlas-tab">
					<button
						v-for="option in modes"
						:key="option.value"
						class="atlas-tab-item"
						:class="{ selected: mode === option.value }"
						:data-synth-mode="option.value"
						@click="setMode(option.value)"
					>
						{{ option.label }}
					</button>
				</div>
				<div class="synthesis-main">
					<div id="synthesisCircle" class="synthesis-success" />
					<div id="synthesisSlots" class="synthesis-list">
						<button
							v-for="(item, index) in slots"
							:key="index"
							class="synthesis-item"
							@click="materialsOpen = true"
						>
							<div
								v-if="item"
								class="synthesis-thumb"
								:class="`synthesis-thumb--${selectedGroup.rarity}`"
							>
								<img :src="assetPath(item.thumbnail)" draggable="false" />
							</div>
							<div v-else class="synthesis-add" />
						</button>
					</div>
					<div class="synthesis-tip">
						Combine {{ cost }} items of the same type and rarity to synthesize 1 random
						{{ mode === "same" ? "same-tier" : "higher-tier" }} item.
					</div>
					<div class="synthesis-btns">
						<button id="autoSelect" class="common-btn" @click="autoSelect">Auto Select</button>
						<button
							v-for="count in [1, 10] as const"
							:key="count"
							class="common-btn"
							:data-synth-count="count"
							:disabled="working || !selectedGroup || selectedGroup.count < cost * count"
							@click="synthesize(count)"
						>
							Synthesize {{ count }}
						</button>
					</div>
					<p id="synthesisSelected" class="synthesis-selected">
						<template v-if="selectedGroup">
							{{ TYPE_LABELS[selectedGroup.type] }} · {{ RARITY_LABELS[selectedGroup.rarity] }} ·
							Duplicates:
							{{ selectedGroup.count }}
						</template>
					</p>
				</div>
			</div>
		</div>
		<!-- Native dialogs render in the top layer; teleporting keeps them outside the scaled stage like the others. -->
		<Teleport to="body">
			<ModalDialog id="materialPicker" v-model:open="materialsOpen">
				<button id="closeMaterials" class="popup-close" @click="materialsOpen = false" />
				<h2>Select Synthesis Materials</h2>
				<div id="materialGroups">
					<button
						v-for="group in groups"
						:key="group.key"
						class="material-group"
						:disabled="group.count < cost"
						@click="chooseGroup(group)"
					>
						<strong>{{ TYPE_LABELS[group.type] }} · {{ RARITY_LABELS[group.rarity] }}</strong>
						<p>{{ group.count }} duplicates</p>
					</button>
				</div>
				<p>Only duplicate copies will be consumed. The last copy is always kept.</p>
			</ModalDialog>
		</Teleport>
	</section>
</template>
