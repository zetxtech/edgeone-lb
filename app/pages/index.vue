<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
    <!-- Header -->
    <header class="border-b border-slate-700/50 backdrop-blur-sm bg-slate-900/50 sticky top-0 z-40">
      <div class="max-w-6xl mx-auto px-6 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 class="text-xl font-bold text-white">EdgeOne LB</h1>
              <p class="text-xs text-slate-400">Load Balancer Manager</p>
            </div>
          </div>
          <button 
            @click="exportConfig" 
            class="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-200 rounded-lg transition-all duration-200 border border-slate-600/50 hover:border-slate-500/50"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Config
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-6xl mx-auto px-6 py-8">
      <!-- Stats Bar -->
      <div class="grid grid-cols-3 gap-4 mb-8">
        <div class="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
          <div class="text-2xl font-bold text-white">{{ Object.keys(rules).length }}</div>
          <div class="text-sm text-slate-400">Domains</div>
        </div>
        <div class="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
          <div class="text-2xl font-bold text-cyan-400">{{ totalTargets }}</div>
          <div class="text-sm text-slate-400">Targets</div>
        </div>
        <div class="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
          <div class="text-2xl font-bold text-emerald-400">Active</div>
          <div class="text-sm text-slate-400">Status</div>
        </div>
      </div>

      <!-- Global Health Check Trigger -->
      <div class="bg-slate-800/50 backdrop-blur-sm rounded-xl p-5 border border-slate-700/50 mb-6">
        <div class="flex items-center gap-2 mb-3">
          <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span class="text-sm font-medium text-slate-300">Global Health Check Trigger</span>
        </div>
        <p class="text-xs text-slate-400 mb-3">
          Trigger health checks for all backend targets across all domains. Visit this URL on the management interface:
        </p>
        <button 
          @click="copyToClipboard(`${currentOrigin}/_trigger_health_check`)"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-all cursor-pointer border border-amber-500/30"
          :title="`Copy: ${currentOrigin}/_trigger_health_check`"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {{ currentOrigin }}/_trigger_health_check
        </button>
      </div>

      <!-- Add Domain Button -->
      <button 
        @click="showAddDomain = true" 
        class="w-full mb-6 py-4 border-2 border-dashed border-slate-600/50 hover:border-cyan-500/50 rounded-xl text-slate-400 hover:text-cyan-400 transition-all duration-200 flex items-center justify-center gap-2 group"
      >
        <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Add New Domain
      </button>

      <!-- Domain Cards -->
      <div class="space-y-4">
        <div 
          v-for="(rule, domain) in rules" 
          :key="domain" 
          class="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden hover:border-slate-600/50 transition-all duration-200"
        >
          <!-- Domain Header -->
          <div class="px-6 py-4 border-b border-slate-700/50">
            <div class="flex items-start justify-between">
              <div class="flex items-start gap-3 flex-1">
                <div class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mt-1.5"></div>
                <div class="flex-1 min-w-0">
                  <h2 class="text-lg font-semibold text-white font-mono mb-3">{{ domain }}</h2>
                  
                  <!-- Tags Row -->
                  <div class="flex items-center gap-2 mb-3 flex-wrap">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                      </svg>
                      EdgeOne
                    </span>
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-slate-700/50 text-slate-300 border border-slate-600/30" :title="rule.forceHttps ? 'HTTP requests will be redirected to HTTPS' : 'Both HTTP and HTTPS are allowed'">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      {{ rule.forceHttps ? 'HTTPS Forced' : 'HTTPS Optional' }}
                    </span>
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-slate-700/50 text-slate-300 border border-slate-600/30" :title="`Backend health check path: ${rule.healthPath}`">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Backend Health: {{ rule.healthPath }}
                    </span>
                  </div>

                  <!-- Health Check URL -->
                  <div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700/30">
                    <div class="flex items-start gap-2">
                      <svg class="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div class="flex-1 min-w-0">
                        <div class="text-xs text-slate-400 mb-1.5">Health Check Endpoint</div>
                        <button 
                          @click="copyToClipboard(`https://${domain}/_health`)"
                          class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-all cursor-pointer border border-emerald-500/30 group"
                          :title="`Copy: https://${domain}/_health`"
                        >
                          <svg class="w-3.5 h-3.5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          https://{{ domain }}/_health
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Action Buttons -->
              <div class="flex items-center gap-2 ml-4">
                <button 
                  @click="editDomain(domain)" 
                  class="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-all"
                  title="Edit"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button 
                  @click="deleteDomain(domain)" 
                  class="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                  title="Delete"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Targets List -->
          <div class="px-6 py-4">
            <div class="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Backend Targets</div>
            <div class="space-y-2">
              <div 
                v-for="(target, idx) in rule.targets" 
                :key="idx"
                class="flex items-center justify-between py-2 px-3 bg-slate-900/50 rounded-lg group"
              >
                <div class="flex items-center gap-3">
                  <span :class="getTypeBadgeClass(target.type)" class="px-2 py-0.5 rounded text-xs font-medium uppercase">
                    {{ target.type }}
                  </span>
                  <code class="text-sm text-slate-300 font-mono">{{ target.host }}</code>
                </div>
                <button 
                  @click="removeTarget(domain, idx)" 
                  class="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div v-if="rule.targets.length === 0" class="text-sm text-slate-500 text-center py-4">
                No targets configured
              </div>
            </div>
            <button 
              @click="openAddTarget(domain)" 
              class="mt-3 w-full py-2 text-sm text-slate-400 hover:text-cyan-400 hover:bg-slate-700/30 rounded-lg transition-all flex items-center justify-center gap-1"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Add Target
            </button>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="Object.keys(rules).length === 0" class="text-center py-16">
          <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
            <svg class="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
          <h3 class="text-lg font-medium text-slate-400 mb-2">No domains configured</h3>
          <p class="text-sm text-slate-500 mb-4">Get started by adding your first domain</p>
        </div>
      </div>
    </main>

    <!-- Add/Edit Domain Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddDomain" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeAddDomain"></div>
          <div class="relative bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-slate-700/50 shadow-2xl">
            <h3 class="text-xl font-semibold text-white mb-6">
              {{ editingDomain ? 'Edit Domain' : 'Add Domain' }}
            </h3>
            <form @submit.prevent="saveDomain" class="space-y-5">
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-2">Domain</label>
                <input 
                  v-model="domainForm.domain" 
                  type="text" 
                  class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all"
                  placeholder="api.example.com"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-2">Health Check Path</label>
                <input 
                  v-model="domainForm.healthPath" 
                  type="text" 
                  class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all"
                  placeholder="/"
                />
                <p class="mt-1 text-xs text-slate-500">
                  Path used for backend health checks (e.g., /, /health, /api/status)
                </p>
              </div>
              <label class="flex items-center gap-3 cursor-pointer group">
                <div class="relative">
                  <input v-model="domainForm.forceHttps" type="checkbox" class="sr-only peer" />
                  <div class="w-11 h-6 bg-slate-700 rounded-full peer-checked:bg-cyan-500 transition-colors"></div>
                  <div class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                </div>
                <span class="text-sm text-slate-300 group-hover:text-white transition-colors">Force HTTPS Redirect</span>
              </label>
              <div class="flex gap-3 pt-4">
                <button 
                  type="button" 
                  @click="closeAddDomain" 
                  class="flex-1 px-4 py-3 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  class="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-medium rounded-xl transition-all"
                >
                  {{ editingDomain ? 'Save Changes' : 'Add Domain' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Add Target Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddTarget" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showAddTarget = false"></div>
          <div class="relative bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-slate-700/50 shadow-2xl">
            <h3 class="text-xl font-semibold text-white mb-2">Add Target</h3>
            <p class="text-sm text-slate-400 mb-6">Add a backend target for <code class="text-cyan-400">{{ targetDomain }}</code></p>
            <form @submit.prevent="saveTarget" class="space-y-5">
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-2">Host</label>
                <input 
                  v-model="targetForm.host" 
                  type="text" 
                  class="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all font-mono"
                  placeholder="backend.example.com:443"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-2">Type</label>
                <div class="grid grid-cols-3 gap-2">
                  <button 
                    type="button"
                    @click="targetForm.type = 'frp'"
                    :class="[
                      'px-4 py-3 rounded-xl text-sm font-medium transition-all border',
                      targetForm.type === 'frp' 
                        ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' 
                        : 'bg-slate-900/50 border-slate-600/50 text-slate-400 hover:border-slate-500/50'
                    ]"
                  >
                    FRP
                  </button>
                  <button 
                    type="button"
                    @click="targetForm.type = 'tunnel'"
                    :class="[
                      'px-4 py-3 rounded-xl text-sm font-medium transition-all border',
                      targetForm.type === 'tunnel' 
                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' 
                        : 'bg-slate-900/50 border-slate-600/50 text-slate-400 hover:border-slate-500/50'
                    ]"
                  >
                    Tunnel
                  </button>
                  <button 
                    type="button"
                    @click="targetForm.type = 'direct'"
                    :class="[
                      'px-4 py-3 rounded-xl text-sm font-medium transition-all border',
                      targetForm.type === 'direct' 
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' 
                        : 'bg-slate-900/50 border-slate-600/50 text-slate-400 hover:border-slate-500/50'
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
                  class="flex-1 px-4 py-3 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  class="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-medium rounded-xl transition-all"
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
const currentOrigin = ref('')

const showAddDomain = ref(false)
const showAddTarget = ref(false)
const editingDomain = ref(null)
const targetDomain = ref('')

const domainForm = ref({
  domain: '',
  healthPath: '/',
  forceHttps: true
})

const targetForm = ref({
  host: '',
  type: 'frp'
})

const totalTargets = computed(() => {
  return Object.values(rules.value).reduce((sum, rule) => sum + (rule.targets?.length || 0), 0)
})

onMounted(async () => {
  if (process.client) {
    currentOrigin.value = window.location.origin
  }
  await loadRules()
})

async function loadRules() {
  try {
    const data = await $fetch('/api/rules')
    rules.value = data
  } catch (e) {
    console.error('Failed to load rules:', e)
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
          platform: 'edgeone' // Mark as EdgeOne configuration
        }
      }
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
    domain: domain,
    healthPath: rules.value[domain].healthPath,
    forceHttps: rules.value[domain].forceHttps
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
      body: targetForm.value
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
      method: 'DELETE'
    })
    await loadRules()
  } catch (e) {
    console.error('Failed to remove target:', e)
  }
}

function getTypeBadgeClass(type) {
  const classes = {
    frp: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
    tunnel: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    direct: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
  }
  return classes[type] || 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
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
