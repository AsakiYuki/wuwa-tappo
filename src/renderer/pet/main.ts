import { createApp } from "vue"
import "../../../assets/ui/application/styles.css"
import "../../styles/pet.scss"
import PetApp from "./PetApp.vue"
import { emotionMotion } from "./lib/emotion-motion"

// QA (src/node/qa.ts) samples the spring animation's tick counter from the page.
Object.assign(window, { emotionMotion })

createApp(PetApp).mount("#root")
