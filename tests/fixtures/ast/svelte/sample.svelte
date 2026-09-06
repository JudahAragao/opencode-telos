<script lang="ts">
import { writable } from "svelte/store"
export let account: unknown
const state = writable(account)
</script>
<main>{account}</main>
