<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
    <main class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <section class="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-400">EdgeOne</p>
          <h1 class="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Load Balancer Admin</h1>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            Manage domains, backend targets, HTTPS redirects, and health check paths for your EdgeOne Pages load balancer.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            @click="triggerHealthCheck"
            class="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Run Health Check
          </button>
          <button
            @click="exportConfig"
            class="inline-flex items-center gap-2 rounded-xl border border-slate-600/40 bg-slate-800/60 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-white"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 16V4m0 12l-4-4m4 4l4-4m5 8H3" />
            </svg>
            Export Config
          </button>
          <button
            @click="showAddDomain = true"
            class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Domain
          </button>
        </div>
      </section>

      <section class="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
          <div class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Domains</div>
          <div class="mt-3 text-3xl font-semibold text-white">{{ Object.keys(rules).length }}</div>
        </div>
        <div class="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
          <div class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Targets</div>
          <div class="mt-3 text-3xl font-semibold text-white">{{ totalTargets }}</div>
        </div>
        <div class="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
          <div class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">HTTPS Redirects</div>
          <div class="mt-3 text-3xl font-semibold text-white">{{ forceHttpsCount }}</div>
        </div>
        <div class="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-5 backdrop-blur-sm">
          <div class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Health Endpoints</div>
          <div class="mt-3 text-3xl font-semibold text-white">{{ Object.keys(rules).length }}</div>
        </div>
      </section>

      <section class="space-y-4">
        <div
          v-for="(rule, domain) in rules"
          :key="domain"
          class="overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/50 backdrop-blur-sm transition hover:border-slate-600/50"
        >
          <div class="border-b border-slate-700/50 px-6 py-5">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 flex-1">
                <div class="mb-3 flex items-center gap-3">
                  <div class="h-2 w-2 rounded-full bg-emerald-400"></div>
                  <h2 class="truncate font-mono text-lg font-semibold text-white">{{ domain }}</h2>
                </div>

                <div class="mb-3 flex flex-wrap items-center gap-2">
                  <span class="inline-flex items-center gap-1.5 rounded border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-400">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                    </svg>
                    EdgeOne
                  </span>
                  <span class="inline-flex items-center gap-1.5 rounded border border-slate-600/30 bg-slate-700/50 px-2.5 py-1 text-xs font-medium text-slate-300">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {{ rule.forceHttps ? 'HTTPS Forced' : 'HTTPS Optional' }}
                  </span>
                  <span class="inline-flex items-center gap-1.5 rounded border border-slate-600/30 bg-slate-700/50 px-2.5 py-1 text-xs font-medium text-slate-300">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Backend Health: {{ rule.healthPath }}
                  </span>
                  <span class="inline-flex items-center gap-1.5 rounded border border-slate-600/30 bg-slate-700/50 px-2.5 py-1 text-xs font-medium text-slate-300">
                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14-7H5m14 14H5" />
                    </svg>
                    {{ rule.targets.length }} Targets
                  </span>
                </div>

                <div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-3">
                  <div class="mb-1.5 text-xs text-slate-400">Health Report Endpoint</div>
                  <div class="flex flex-wrap gap-2">
                    <button
                      @click="copyToClipboard(`https://${domain}/_health`)"
                      class="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-mono text-xs text-emerald-300 transition hover:bg-emerald-500/20"
                      :title="`Copy: https://${domain}/_health`"
                    >
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      https://{{ domain }}/_health
                    </button>
                    <button
                      @click="copyToClipboard(`https://${domain}/_trigger_health_check`)"
                      class="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs text-cyan-300 transition hover:bg-cyan-500/20"
                      :title="`Copy: https://${domain}/_trigger_health_check`"
                    >
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      https://{{ domain }}/_trigger_health_check
                    </button>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 lg:ml-4">
                <button
                  @click="editDomain(domain)"
                  class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-white"
                  title="Edit"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  @click="deleteDomain(domain)"
                  class="rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-400"
                  title="Delete"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div class="px-6 py-4">
            <div class="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-slate-500">Backend Targets</div>
            <div class="space-y-2">
              <div
                v-for="(target, idx) in rule.targets"
                :key="idx"
                class="group flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2"
              >
                <div class="flex items-center gap-3">
                  <span :class="getTypeBadgeClass(target.type)" class="rounded px-2 py-0.5 text-xs font-medium uppercase">
                    {{ target.type }}
                  </span>
                  <code class="font-mono text-sm text-slate-300">{{ target.host }}</code>
                </div>
                <button
                  @click="removeTarget(domain, idx)"
                  class="p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                  title="Remove target"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div v-if="rule.targets.length === 0" class="py-4 text-center text-sm text-slate-500">
                No targets configured
              </div>
            </div>

            <button
              @click="openAddTarget(domain)"
              class="mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-sm text-slate-400 transition hover:bg-slate-700/30 hover:text-cyan-400"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Add Target
            </button>
          </div>
        </div>

        <div v-if="Object.keys(rules).length === 0" class="rounded-2xl border border-slate-700/50 bg-slate-800/40 px-6 py-16 text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800/50">
            <svg class="h-8 w-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
          <h3 class="mb-2 text-lg font-medium text-slate-300">No domains configured</h3>
          <p class="mb-4 text-sm text-slate-500">Get started by adding your first domain.</p>
          <button
            @click="showAddDomain = true"
            class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Domain
          </button>
        </div>
      </section>
    </main>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddDomain" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeAddDomain"></div>
          <div class="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
            <h3 class="mb-6 text-xl font-semibold text-white">{{ editingDomain ? 'Edit Domain' : 'Add Domain' }}</h3>
            <form @submit.prevent="saveDomain" class="space-y-5">
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">Domain</label>
                <input
                  v-model="domainForm.domain"
                  type="text"
                  class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  placeholder="api.example.com"
                />
              </div>
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">Health Check Path</label>
                <input
                  v-model="domainForm.healthPath"
                  type="text"
                  class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  placeholder="/"
                />
                <p class="mt-1 text-xs text-slate-500">Path used for backend health checks, for example /health.</p>
              </div>
              <label class="group flex cursor-pointer items-center gap-3">
                <div class="relative">
                  <input v-model="domainForm.forceHttps" type="checkbox" class="peer sr-only" />
                  <div class="h-6 w-11 rounded-full bg-slate-700 transition-colors peer-checked:bg-cyan-500"></div>
                  <div class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5"></div>
                </div>
                <span class="text-sm text-slate-300 transition group-hover:text-white">Force HTTPS Redirect</span>
              </label>
              <div class="flex gap-3 pt-4">
                <button
                  type="button"
                  @click="closeAddDomain"
                  class="flex-1 rounded-xl bg-slate-700/50 px-4 py-3 text-slate-300 transition hover:bg-slate-600/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
                >
                  {{ editingDomain ? 'Save Changes' : 'Add Domain' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddTarget" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showAddTarget = false"></div>
          <div class="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
            <h3 class="mb-2 text-xl font-semibold text-white">Add Target</h3>
            <p class="mb-6 text-sm text-slate-400">Add a backend target for <code class="text-cyan-400">{{ targetDomain }}</code></p>
            <form @submit.prevent="saveTarget" class="space-y-5">
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">Host</label>
                <input
                  v-model="targetForm.host"
                  type="text"
                  class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 font-mono text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  placeholder="backend.example.com:443"
                />
              </div>
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">Type</label>
                <div class="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    @click="targetForm.type = 'frp'"
                    :class="[
                      'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                      targetForm.type === 'frp'
                        ? 'border-purple-500/50 bg-purple-500/20 text-purple-300'
                        : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50'
                    ]"
                  >
                    FRP
                  </button>
                  <button
                    type="button"
                    @click="targetForm.type = 'tunnel'"
                    :class="[
                      'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                      targetForm.type === 'tunnel'
                        ? 'border-blue-500/50 bg-blue-500/20 text-blue-300'
                        : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50'
                    ]"
                  >
                    Tunnel
                  </button>
                  <button
                    type="button"
                    @click="targetForm.type = 'direct'"
                    :class="[
                      'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                      targetForm.type === 'direct'
                        ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                        : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50'
                    ]"
                  >
                    Direct
                  </button>
                </div>
              </div>
              <div class="flex gap-3 pt-4">
                <button
                  type="button"
                  @click="showAddTarget = false"
                  class="flex-1 rounded-xl bg-slate-700/50 px-4 py-3 text-slate-300 transition hover:bg-slate-600/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
                >
                  Add Target
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
const rules = ref({})

const showAddDomain = ref(false)
const showAddTarget = ref(false)
const editingDomain = ref(null)
const targetDomain = ref('')

const domainForm = ref({
  domain: '',
  healthPath: '/',
  forceHttps: true,
})

const targetForm = ref({
  host: '',
  type: 'frp',
})

const totalTargets = computed(() => {
  return Object.values(rules.value).reduce((sum, rule) => sum + (rule.targets?.length || 0), 0)
})

const forceHttpsCount = computed(() => {
  return Object.values(rules.value).filter((rule) => rule.forceHttps).length
})

onMounted(async () => {
  await loadRules()
})

async function loadRules() {
  try {
    rules.value = await $fetch('/api/rules')
  } catch (e) {
    console.error('Failed to load rules:', e)
  }
}

async function triggerHealthCheck() {
  try {
    await $fetch('/_trigger_health_check')
  } catch (e) {
    console.error('Failed to trigger health check:', e)
    alert('Failed to trigger health check: ' + e.message)
  }
}

async function saveDomain() {
  if (!domainForm.value.domain) return

  try {
    const isRename = editingDomain.value && editingDomain.value !== domainForm.value.domain

    await $fetch('/api/rules', {
      method: 'POST',
      body: {
        domain: domainForm.value.domain,
        oldDomain: isRename ? editingDomain.value : undefined,
        rule: {
          forceHttps: domainForm.value.forceHttps,
          healthPath: domainForm.value.healthPath,
          targets: editingDomain.value ? rules.value[editingDomain.value].targets : [],
          platform: 'edgeone',
        },
      },
    })
    await loadRules()
    closeAddDomain()
  } catch (e) {
    console.error('Failed to save domain:', e)
    alert('Failed to save domain: ' + e.message)
  }
}

function editDomain(domain) {
  editingDomain.value = domain
  domainForm.value = {
    domain,
    healthPath: rules.value[domain].healthPath,
    forceHttps: rules.value[domain].forceHttps,
  }
  showAddDomain.value = true
}

function closeAddDomain() {
  showAddDomain.value = false
  editingDomain.value = null
  domainForm.value = { domain: '', healthPath: '/', forceHttps: true }
}

async function deleteDomain(domain) {
  if (!confirm(`Delete domain "${domain}"?`)) return

  try {
    await $fetch(`/api/rules/${encodeURIComponent(domain)}`, { method: 'DELETE' })
    await loadRules()
  } catch (e) {
    console.error('Failed to delete domain:', e)
  }
}

function openAddTarget(domain) {
  targetDomain.value = domain
  targetForm.value = { host: '', type: 'frp' }
  showAddTarget.value = true
}

async function saveTarget() {
  if (!targetForm.value.host) return

  try {
    await $fetch(`/api/rules/${encodeURIComponent(targetDomain.value)}/targets`, {
      method: 'POST',
      body: targetForm.value,
    })
    await loadRules()
    showAddTarget.value = false
  } catch (e) {
    console.error('Failed to add target:', e)
  }
}

async function removeTarget(domain, index) {
  try {
    await $fetch(`/api/rules/${encodeURIComponent(domain)}/targets/${index}`, {
      method: 'DELETE',
    })
    await loadRules()
  } catch (e) {
    console.error('Failed to remove target:', e)
  }
}

function getTypeBadgeClass(type) {
  const classes = {
    frp: 'border border-purple-500/30 bg-purple-500/20 text-purple-300',
    tunnel: 'border border-blue-500/30 bg-blue-500/20 text-blue-300',
    direct: 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300',
  }
  return classes[type] || 'border border-slate-500/30 bg-slate-500/20 text-slate-300'
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch (e) {
    console.error('Failed to copy:', e)
  }
}

async function exportConfig() {
  try {
    const config = await $fetch('/api/export')
    const blob = new Blob([config], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'edgeone-function.js'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('Failed to export config:', e)
  }
}
</script>

<style>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.95) translateY(10px);
}
</style>
