<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
    <main class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <!-- Header -->
      <section class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-400">EdgeOne</p>
          <h1 class="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{{ t.title }}</h1>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-400">{{ t.subtitle }}</p>
        </div>
        <div class="flex items-center gap-3">
          <button
            @click="lang = lang === 'en' ? 'zh' : 'en'"
            class="rounded-lg border border-slate-600/50 bg-slate-800/50 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500/50 hover:text-white"
          >{{ t.langSwitch }}</button>
          <button
            @click="showAddDomain = true"
            class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:from-cyan-400 hover:to-blue-400"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            {{ t.addDomain }}
          </button>
        </div>
      </section>

      <!-- Domain List -->
      <section class="space-y-4">
        <div
          v-for="(rule, domain) in rules" :key="domain"
          class="overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/50 backdrop-blur-sm transition hover:border-slate-600/50"
        >
          <!-- Domain Header -->
          <div class="border-b border-slate-700/50 px-6 py-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="min-w-0 flex-1">
                <div class="mb-2 flex items-center gap-3">
                  <div class="h-2 w-2 rounded-full bg-emerald-400"></div>
                  <h2 class="truncate font-mono text-lg font-semibold text-white">{{ domain }}</h2>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="inline-flex items-center rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-xs font-medium text-cyan-400">{{ t.platform }}</span>
                  <span class="inline-flex items-center rounded border border-slate-600/30 bg-slate-700/50 px-2 py-0.5 text-xs font-medium text-slate-300">{{ rule.forceHttps ? t.forceHttps : t.httpsOptional }}</span>
                  <span class="inline-flex items-center rounded border border-slate-600/30 bg-slate-700/50 px-2 py-0.5 text-xs font-medium text-slate-300">{{ rule.targets.length }} {{ t.targets }}</span>
                </div>
              </div>
              <div class="flex items-center gap-1">
                <button @click="editDomain(domain)" class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-white" :title="t.edit">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button @click="deleteDomain(domain)" class="rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-400" :title="t.delete">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Targets -->
          <div class="px-6 py-4">
            <div class="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-slate-500">{{ t.targets }}</div>
            <div class="space-y-2">
              <div v-for="(target, idx) in rule.targets" :key="idx" class="group flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2">
                <div class="flex items-center gap-3">
                  <span :class="getTypeBadgeClass(target.type)" class="rounded px-2 py-0.5 text-xs font-medium uppercase">{{ target.type }}</span>
                  <code class="font-mono text-sm text-slate-300">{{ target.host }}</code>
                </div>
                <button @click="removeTarget(domain, idx)" class="p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-red-400" :title="t.removeTarget">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div v-if="rule.targets.length === 0" class="py-4 text-center text-sm text-slate-500">{{ t.noTargets }}</div>
            </div>
            <button @click="openAddTarget(domain)" class="mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-sm text-slate-400 transition hover:bg-slate-700/30 hover:text-cyan-400">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
              {{ t.addTarget }}
            </button>
          </div>

          <!-- Health Check (collapsible) -->
          <div class="border-t border-slate-700/50">
            <button @click="toggleHealthCheck(domain)" class="flex w-full items-center justify-between px-6 py-3 text-left transition hover:bg-slate-700/20">
              <span class="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">{{ t.healthCheck }}</span>
              <svg :class="['h-4 w-4 text-slate-500 transition-transform', expandedHealthChecks[domain] ? 'rotate-180' : '']" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            <div v-if="expandedHealthChecks[domain]" class="border-t border-slate-700/30 px-6 py-4">
              <div class="space-y-3">
                <div>
                  <div class="mb-1 text-[11px] uppercase tracking-[0.2em] text-emerald-400">{{ t.cachedStatus }}</div>
                  <div tabindex="0" @click="copyToClipboard('https://'+domain+'/_health')" @keydown.enter.prevent="copyToClipboard('https://'+domain+'/_health')" @keydown.space.prevent="copyToClipboard('https://'+domain+'/_health')" class="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 transition hover:border-emerald-400/40 hover:bg-emerald-500/10">
                    <code class="min-w-0 flex-1 truncate font-mono text-xs text-emerald-300">https://{{ domain }}/_health</code>
                    <span class="shrink-0 text-[11px] font-medium text-emerald-400 transition group-hover:text-emerald-300">{{ t.copy }}</span>
                  </div>
                </div>
                <div>
                  <div class="mb-1 text-[11px] uppercase tracking-[0.2em] text-cyan-400">{{ t.triggerRefresh }}</div>
                  <div tabindex="0" @click="copyToClipboard('https://'+domain+'/_trigger_health_check')" @keydown.enter.prevent="copyToClipboard('https://'+domain+'/_trigger_health_check')" @keydown.space.prevent="copyToClipboard('https://'+domain+'/_trigger_health_check')" class="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 transition hover:border-cyan-400/40 hover:bg-cyan-500/10">
                    <code class="min-w-0 flex-1 truncate font-mono text-xs text-cyan-300">https://{{ domain }}/_trigger_health_check</code>
                    <span class="shrink-0 text-[11px] font-medium text-cyan-400 transition group-hover:text-cyan-300">{{ t.copy }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="Object.keys(rules).length === 0" class="rounded-2xl border border-slate-700/50 bg-slate-800/40 px-6 py-16 text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800/50">
            <svg class="h-8 w-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
          </div>
          <h3 class="mb-2 text-lg font-medium text-slate-300">{{ t.noDomains }}</h3>
          <p class="mb-4 text-sm text-slate-500">{{ t.noDomainsHint }}</p>
          <button @click="showAddDomain = true" class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 text-sm font-medium text-white transition hover:from-cyan-400 hover:to-blue-400">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            {{ t.addDomain }}
          </button>
        </div>
      </section>

      <!-- Health Check Tools (collapsible) -->
      <section class="mt-8 overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/50 backdrop-blur-sm">
        <button @click="healthToolsExpanded = !healthToolsExpanded" class="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-slate-700/20">
          <div>
            <div class="text-xs font-medium uppercase tracking-[0.25em] text-cyan-400">{{ t.healthCheckTools }}</div>
            <p class="mt-1 text-sm text-slate-500">{{ t.healthCheckToolsDesc }}</p>
          </div>
          <svg :class="['h-4 w-4 text-slate-500 transition-transform', healthToolsExpanded ? 'rotate-180' : '']" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </button>
        <div v-if="healthToolsExpanded" class="border-t border-slate-700/30 px-6 py-4">
          <div tabindex="0" @click="copyToClipboard(globalTriggerHealthCheckUrl)" @keydown.enter.prevent="copyToClipboard(globalTriggerHealthCheckUrl)" @keydown.space.prevent="copyToClipboard(globalTriggerHealthCheckUrl)" class="group flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 transition hover:border-cyan-400/40 hover:bg-cyan-500/10">
            <code class="min-w-0 flex-1 truncate font-mono text-sm text-cyan-300">{{ globalTriggerHealthCheckUrl }}</code>
            <span class="shrink-0 text-xs font-medium text-cyan-400 transition group-hover:text-cyan-300">{{ t.copy }}</span>
          </div>
        </div>
      </section>

      <!-- Debug Logs (collapsible, at bottom) -->
      <section class="mt-4 overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/50 backdrop-blur-sm">
        <button @click="debugLogsExpanded = !debugLogsExpanded" class="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-slate-700/20">
          <div>
            <div class="text-xs font-medium uppercase tracking-[0.25em] text-fuchsia-400">{{ t.debugLogs }}</div>
            <p class="mt-1 text-sm text-slate-500">{{ t.debugLogsDesc }} <code class="font-mono text-fuchsia-400">EdgeoneLBDebugger</code> {{ t.debugLogsHint }}</p>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="debugLogs.length > 0" class="rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-xs font-medium text-fuchsia-300">{{ debugLogs.length }}</span>
            <svg :class="['h-4 w-4 text-slate-500 transition-transform', debugLogsExpanded ? 'rotate-180' : '']" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
          </div>
        </button>
        <div v-if="debugLogsExpanded" class="border-t border-slate-700/30 px-6 py-4">
          <div class="mb-4 flex justify-end">
            <button @click="loadDebugLogs" :disabled="debugLogsLoading" class="inline-flex items-center justify-center rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-2 text-sm font-medium text-fuchsia-300 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-60">
              {{ debugLogsLoading ? t.refreshing : t.refreshLogs }}
            </button>
          </div>
          <div v-if="debugLogsError" class="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{{ debugLogsError }}</div>
          <div v-else-if="debugLogs.length > 0" class="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div class="space-y-2">
              <button v-for="item in debugLogs" :key="item.id" type="button" @click="selectDebugLog(item.id)" :class="['w-full rounded-xl border px-4 py-3 text-left transition', selectedDebugLogId === item.id ? 'border-fuchsia-400/40 bg-fuchsia-500/10' : 'border-slate-700/50 bg-slate-900/40 hover:border-slate-600/50 hover:bg-slate-900/70']">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="font-mono text-sm text-white">{{ item.request?.method || 'UNKNOWN' }} {{ item.request?.pathname || '/' }}</div>
                  <span :class="getOutcomeBadgeClass(item.outcome)" class="rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.2em]">{{ item.outcome || 'unknown' }}</span>
                </div>
                <div class="mt-1 text-xs text-slate-400">{{ item.request?.hostname || 'Unknown host' }}</div>
                <div class="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>{{ t.status }}: {{ item.response?.status ?? '-' }}</span>
                  <span>{{ t.phase }}: {{ item.phase || '-' }}</span>
                  <span>{{ formatDateTime(item.completedAt || item.createdAt) }}</span>
                </div>
              </button>
            </div>
            <div class="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
              <template v-if="selectedDebugLog">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div class="font-mono text-sm text-white">{{ selectedDebugLog.request?.method || 'UNKNOWN' }} {{ selectedDebugLog.request?.url || '' }}</div>
                    <div class="mt-1 text-xs text-slate-400">ID: {{ selectedDebugLog.id }}</div>
                  </div>
                  <span :class="getOutcomeBadgeClass(selectedDebugLog.outcome)" class="rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.2em]">{{ selectedDebugLog.outcome || 'unknown' }}</span>
                </div>
                <div class="mt-4 grid gap-3 sm:grid-cols-2">
                  <div class="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
                    <div class="mb-1 text-slate-500">{{ t.response }}</div>
                    <div>{{ t.status }}: {{ selectedDebugLog.response?.status ?? '-' }} {{ selectedDebugLog.response?.statusText || '' }}</div>
                    <div class="mt-1">{{ t.duration }}: {{ selectedDebugLog.durationMs ?? '-' }} ms</div>
                    <div class="mt-1">{{ t.phase }}: {{ selectedDebugLog.phase || '-' }}</div>
                  </div>
                  <div class="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
                    <div class="mb-1 text-slate-500">{{ t.trigger }}</div>
                    <div>{{ t.header }}: {{ selectedDebugLog.request?.debugRequestedByHeader ? t.yes : t.no }}</div>
                    <div class="mt-1">User-Agent: {{ selectedDebugLog.request?.debugRequestedByUserAgent ? t.yes : t.no }}</div>
                    <div class="mt-1">{{ t.kind }}: {{ selectedDebugLog.kind || '-' }}</div>
                  </div>
                </div>
                <div class="mt-4 text-xs font-medium uppercase tracking-[0.25em] text-slate-500">{{ t.fullRecord }}</div>
                <pre class="mt-3 max-h-[32rem] overflow-auto rounded-xl bg-slate-950/80 p-4 text-xs leading-6 text-slate-200">{{ formatDebugLog(selectedDebugLog) }}</pre>
              </template>
              <div v-else class="flex min-h-[12rem] items-center justify-center text-sm text-slate-500">{{ t.selectLog }}</div>
            </div>
          </div>
          <div v-else-if="!debugLogsLoading" class="rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-10 text-center text-sm text-slate-500">{{ t.noLogs }}</div>
        </div>
      </section>
    </main>

    <!-- Add/Edit Domain Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showAddDomain" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeAddDomain"></div>
          <div class="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
            <h3 class="mb-6 text-xl font-semibold text-white">{{ editingDomain ? t.save : t.add }}</h3>
            <form @submit.prevent="saveDomain" class="space-y-5">
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">{{ t.domain }}</label>
                <input v-model="domainForm.domain" type="text" class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50" placeholder="api.example.com" />
              </div>
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">{{ t.healthPath }}</label>
                <input v-model="domainForm.healthPath" type="text" class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50" placeholder="/" />
                <p class="mt-1 text-xs text-slate-500">{{ t.healthPathHint }}</p>
              </div>
              <label class="group flex cursor-pointer items-center gap-3">
                <div class="relative">
                  <input v-model="domainForm.forceHttps" type="checkbox" class="peer sr-only" />
                  <div class="h-6 w-11 rounded-full bg-slate-700 transition-colors peer-checked:bg-cyan-500"></div>
                  <div class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5"></div>
                </div>
                <span class="text-sm text-slate-300 transition group-hover:text-white">{{ t.forceHttpsLabel }}</span>
              </label>
              <div class="flex gap-3 pt-4">
                <button type="button" @click="closeAddDomain" class="flex-1 rounded-xl bg-slate-700/50 px-4 py-3 text-slate-300 transition hover:bg-slate-600/50">{{ t.cancel }}</button>
                <button type="submit" class="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 font-medium text-white transition hover:from-cyan-400 hover:to-blue-400">{{ editingDomain ? t.save : t.add }}</button>
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
          <div class="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-800 p-6 shadow-2xl">
            <h3 class="mb-2 text-xl font-semibold text-white">{{ t.addTargetTitle }}</h3>
            <p class="mb-6 text-sm text-slate-400">{{ t.addTargetDesc }} <code class="text-cyan-400">{{ targetDomain }}</code></p>
            <form @submit.prevent="saveTarget" class="space-y-5">
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">{{ t.host }}</label>
                <input v-model="targetForm.host" type="text" class="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-4 py-3 font-mono text-white placeholder-slate-500 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-cyan-500/50" placeholder="backend.example.com:443" />
              </div>
              <div>
                <label class="mb-2 block text-sm font-medium text-slate-300">{{ t.type }}</label>
                <div class="grid grid-cols-3 gap-2">
                  <button type="button" @click="targetForm.type = 'frp'" :class="['rounded-xl border px-4 py-3 text-sm font-medium transition-all', targetForm.type === 'frp' ? 'border-purple-500/50 bg-purple-500/20 text-purple-300' : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50']">FRP</button>
                  <button type="button" @click="targetForm.type = 'tunnel'" :class="['rounded-xl border px-4 py-3 text-sm font-medium transition-all', targetForm.type === 'tunnel' ? 'border-blue-500/50 bg-blue-500/20 text-blue-300' : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50']">Tunnel</button>
                  <button type="button" @click="targetForm.type = 'direct'" :class="['rounded-xl border px-4 py-3 text-sm font-medium transition-all', targetForm.type === 'direct' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' : 'border-slate-600/50 bg-slate-900/50 text-slate-400 hover:border-slate-500/50']">Direct</button>
                </div>
              </div>
              <div class="flex gap-3 pt-4">
                <button type="button" @click="showAddTarget = false" class="flex-1 rounded-xl bg-slate-700/50 px-4 py-3 text-slate-300 transition hover:bg-slate-600/50">{{ t.cancel }}</button>
                <button type="submit" class="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 font-medium text-white transition hover:from-cyan-400 hover:to-blue-400">{{ t.addTarget }}</button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
const i18n = {
  en: {
    title: 'Load Balancer Admin',
    subtitle: 'Manage domains, backend targets, and health checks for your EdgeOne Pages load balancer.',
    addDomain: 'Add Domain',
    noDomains: 'No domains configured',
    noDomainsHint: 'Get started by adding your first domain.',
    targets: 'Targets',
    noTargets: 'No targets configured',
    addTarget: 'Add Target',
    removeTarget: 'Remove target',
    edit: 'Edit',
    delete: 'Delete',
    forceHttps: 'HTTPS Forced',
    httpsOptional: 'HTTPS Optional',
    platform: 'EdgeOne',
    healthCheck: 'Health Check',
    cachedStatus: 'Cached Status',
    triggerRefresh: 'Trigger & Refresh',
    copy: 'Copy',
    debugLogs: 'Debug Logs',
    debugLogsDesc: 'Requests with a User-Agent or request header containing',
    debugLogsHint: 'will appear here after the request fully ends.',
    refreshLogs: 'Refresh Logs',
    refreshing: 'Refreshing...',
    noLogs: 'No debug logs yet.',
    selectLog: 'Select a debug log to inspect details.',
    response: 'Response',
    trigger: 'Trigger',
    status: 'Status',
    phase: 'Phase',
    duration: 'Duration',
    kind: 'Kind',
    header: 'Header',
    yes: 'Yes',
    no: 'No',
    fullRecord: 'Full Record',
    healthCheckTools: 'Health Check Tools',
    healthCheckToolsDesc: 'Trigger health checks for all configured domains.',
    cancel: 'Cancel',
    save: 'Save Changes',
    add: 'Add Domain',
    domain: 'Domain',
    healthPath: 'Health Check Path',
    healthPathHint: 'Path used for backend health checks, for example /health.',
    forceHttpsLabel: 'Force HTTPS Redirect',
    addTargetTitle: 'Add Target',
    addTargetDesc: 'Add a backend target for',
    host: 'Host',
    type: 'Type',
    langSwitch: '\u4e2d\u6587',
  },
  zh: {
    title: '\u8d1f\u8f7d\u5747\u8861\u7ba1\u7406',
    subtitle: '\u7ba1\u7406 EdgeOne Pages \u8d1f\u8f7d\u5747\u8861\u7684\u57df\u540d\u3001\u540e\u7aef\u76ee\u6807\u548c\u5065\u5eb7\u68c0\u67e5\u3002',
    addDomain: '\u6dfb\u52a0\u57df\u540d',
    noDomains: '\u6682\u65e0\u57df\u540d\u914d\u7f6e',
    noDomainsHint: '\u6dfb\u52a0\u4f60\u7684\u7b2c\u4e00\u4e2a\u57df\u540d\u4ee5\u5f00\u59cb\u4f7f\u7528\u3002',
    targets: '\u76ee\u6807',
    noTargets: '\u6682\u65e0\u76ee\u6807\u914d\u7f6e',
    addTarget: '\u6dfb\u52a0\u76ee\u6807',
    removeTarget: '\u79fb\u9664\u76ee\u6807',
    edit: '\u7f16\u8f91',
    delete: '\u5220\u9664',
    forceHttps: '\u5f3a\u5236 HTTPS',
    httpsOptional: 'HTTPS \u53ef\u9009',
    platform: 'EdgeOne',
    healthCheck: '\u5065\u5eb7\u68c0\u67e5',
    cachedStatus: '\u7f13\u5b58\u72b6\u6001',
    triggerRefresh: '\u89e6\u53d1\u5e76\u5237\u65b0',
    copy: '\u590d\u5236',
    debugLogs: '\u8c03\u8bd5\u65e5\u5fd7',
    debugLogsDesc: '\u5305\u542b',
    debugLogsHint: '\u7684 User-Agent \u6216\u8bf7\u6c42\u5934\u7684\u8bf7\u6c42\uff0c\u5c06\u5728\u8bf7\u6c42\u5b8c\u6210\u540e\u663e\u793a\u5728\u6b64\u5904\u3002',
    refreshLogs: '\u5237\u65b0\u65e5\u5fd7',
    refreshing: '\u5237\u65b0\u4e2d...',
    noLogs: '\u6682\u65e0\u8c03\u8bd5\u65e5\u5fd7\u3002',
    selectLog: '\u9009\u62e9\u4e00\u6761\u65e5\u5fd7\u67e5\u770b\u8be6\u60c5\u3002',
    response: '\u54cd\u5e94',
    trigger: '\u89e6\u53d1\u65b9\u5f0f',
    status: '\u72b6\u6001',
    phase: '\u9636\u6bb5',
    duration: '\u8017\u65f6',
    kind: '\u7c7b\u578b',
    header: '\u8bf7\u6c42\u5934',
    yes: '\u662f',
    no: '\u5426',
    fullRecord: '\u5b8c\u6574\u8bb0\u5f55',
    healthCheckTools: '\u5065\u5eb7\u68c0\u67e5\u5de5\u5177',
    healthCheckToolsDesc: '\u89e6\u53d1\u6240\u6709\u5df2\u914d\u7f6e\u57df\u540d\u7684\u5065\u5eb7\u68c0\u67e5\u3002',
    cancel: '\u53d6\u6d88',
    save: '\u4fdd\u5b58\u4fee\u6539',
    add: '\u6dfb\u52a0\u57df\u540d',
    domain: '\u57df\u540d',
    healthPath: '\u5065\u5eb7\u68c0\u67e5\u8def\u5f84',
    healthPathHint: '\u7528\u4e8e\u540e\u7aef\u5065\u5eb7\u68c0\u67e5\u7684\u8def\u5f84\uff0c\u4f8b\u5982 /health\u3002',
    forceHttpsLabel: '\u5f3a\u5236 HTTPS \u8df3\u8f6c',
    addTargetTitle: '\u6dfb\u52a0\u76ee\u6807',
    addTargetDesc: '\u4e3a\u4ee5\u4e0b\u57df\u540d\u6dfb\u52a0\u540e\u7aef\u76ee\u6807\uff1a',
    host: '\u4e3b\u673a\u5730\u5740',
    type: '\u7c7b\u578b',
    langSwitch: 'EN',
  },
}

const lang = ref('en')
const t = computed(() => i18n[lang.value])

const rules = ref({})
const showAddDomain = ref(false)
const showAddTarget = ref(false)
const editingDomain = ref(null)
const targetDomain = ref('')
const debugLogs = ref([])
const debugLogsLoading = ref(false)
const debugLogsError = ref('')
const selectedDebugLogId = ref('')
const selectedDebugLog = ref(null)
const debugLogsExpanded = ref(false)
const healthToolsExpanded = ref(false)
const expandedHealthChecks = ref({})

const domainForm = ref({ domain: '', healthPath: '/', forceHttps: true })
const targetForm = ref({ host: '', type: 'frp' })

const requestUrl = useRequestURL()
const globalTriggerHealthCheckUrl = computed(() => new URL('/_trigger_health_check', requestUrl.origin).toString())

onMounted(async () => { await loadRules() })

async function loadRules() {
  try { rules.value = await $fetch('/api/rules') } catch (e) { console.error('Failed to load rules:', e) }
}

async function loadDebugLogs() {
  debugLogsLoading.value = true
  debugLogsError.value = ''
  try {
    const response = await $fetch('/api/logs')
    debugLogs.value = Array.isArray(response?.items) ? response.items : []
    if (debugLogs.value.length === 0) { selectedDebugLogId.value = ''; selectedDebugLog.value = null; return }
    const nextId = selectedDebugLogId.value && debugLogs.value.some((item) => item.id === selectedDebugLogId.value) ? selectedDebugLogId.value : debugLogs.value[0].id
    await selectDebugLog(nextId)
  } catch (e) {
    console.error('Failed to load debug logs:', e)
    debugLogsError.value = e?.data?.error || e?.message || 'Failed to load debug logs'
  } finally { debugLogsLoading.value = false }
}

async function selectDebugLog(id) {
  if (!id) { selectedDebugLogId.value = ''; selectedDebugLog.value = null; return }
  debugLogsError.value = ''
  selectedDebugLogId.value = id
  try { selectedDebugLog.value = await $fetch('/api/logs', { query: { id } }) }
  catch (e) { console.error('Failed to load debug log detail:', e); debugLogsError.value = e?.data?.error || e?.message || 'Failed to load debug log detail' }
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
        rule: { forceHttps: domainForm.value.forceHttps, healthPath: domainForm.value.healthPath, targets: editingDomain.value ? rules.value[editingDomain.value].targets : [], platform: 'edgeone' },
      },
    })
    await loadRules()
    closeAddDomain()
  } catch (e) { console.error('Failed to save domain:', e); alert('Failed to save domain: ' + e.message) }
}

function editDomain(domain) {
  editingDomain.value = domain
  domainForm.value = { domain, healthPath: rules.value[domain].healthPath, forceHttps: rules.value[domain].forceHttps }
  showAddDomain.value = true
}

function closeAddDomain() {
  showAddDomain.value = false
  editingDomain.value = null
  domainForm.value = { domain: '', healthPath: '/', forceHttps: true }
}

async function deleteDomain(domain) {
  if (!confirm(lang.value === 'zh' ? `\u786e\u5b9a\u5220\u9664\u57df\u540d "${domain}"\uff1f` : `Delete domain "${domain}"?`)) return
  try { await $fetch(`/api/rules/${encodeURIComponent(domain)}`, { method: 'DELETE' }); await loadRules() }
  catch (e) { console.error('Failed to delete domain:', e) }
}

function openAddTarget(domain) { targetDomain.value = domain; targetForm.value = { host: '', type: 'frp' }; showAddTarget.value = true }

async function saveTarget() {
  if (!targetForm.value.host) return
  try { await $fetch(`/api/rules/${encodeURIComponent(targetDomain.value)}/targets`, { method: 'POST', body: targetForm.value }); await loadRules(); showAddTarget.value = false }
  catch (e) { console.error('Failed to add target:', e) }
}

async function removeTarget(domain, index) {
  try { await $fetch(`/api/rules/${encodeURIComponent(domain)}/targets/${index}`, { method: 'DELETE' }); await loadRules() }
  catch (e) { console.error('Failed to remove target:', e) }
}

function toggleHealthCheck(domain) { expandedHealthChecks.value[domain] = !expandedHealthChecks.value[domain] }

function getTypeBadgeClass(type) {
  const classes = { frp: 'border border-purple-500/30 bg-purple-500/20 text-purple-300', tunnel: 'border border-blue-500/30 bg-blue-500/20 text-blue-300', direct: 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300' }
  return classes[type] || 'border border-slate-500/30 bg-slate-500/20 text-slate-300'
}

async function copyToClipboard(text) { try { await navigator.clipboard.writeText(text) } catch (e) { console.error('Failed to copy:', e) } }

function getOutcomeBadgeClass(outcome) {
  const classes = { success: 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300', redirect: 'border border-cyan-500/30 bg-cyan-500/20 text-cyan-300', 'client-error': 'border border-amber-500/30 bg-amber-500/20 text-amber-300', 'server-error': 'border border-red-500/30 bg-red-500/20 text-red-300', unknown: 'border border-slate-500/30 bg-slate-500/20 text-slate-300' }
  return classes[outcome] || classes.unknown
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function formatDebugLog(log) { return JSON.stringify(log, null, 2) }
</script>

<style>
.modal-enter-active,
.modal-leave-active { transition: all 0.3s ease; }
.modal-enter-from,
.modal-leave-to { opacity: 0; }
.modal-enter-from .relative,
.modal-leave-to .relative { transform: scale(0.95) translateY(10px); }
</style>
