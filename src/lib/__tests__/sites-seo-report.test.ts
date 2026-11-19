import { describe, expect, it } from 'vitest'
import {
  buildSeoReportCsv,
  seoReportFilename,
} from '@/src/lib/sites/search/seo-report'
import type { SiteSeoDetailDTO } from '@/types/site-seo'

const detail: SiteSeoDetailDTO = {
  generatedAt: '2026-11-19T12:00:00.000Z',
  card: {
    id: 's1',
    name: 'Clínica "Sorriso"',
    slug: 'sorriso',
    status: 'PUBLISHED',
    url: 'https://sorriso.sites.test',
    pageCount: 2,
    hasData: true,
    averages: { seo: 70, aeo: 50, geo: 40 },
    overall: 53,
    issueCount: 9,
    topIssues: [],
    worstPages: [],
    technical: { pass: 1, warn: 0, fail: 1, total: 2 },
    keywordCount: 2,
    indexNow: { enabled: false, canPing: false },
    history: [],
    delta: null,
  },
  pages: [
    {
      id: 'p1',
      title: 'Início',
      path: '/',
      scores: { seo: 80, aeo: 60, geo: 50 },
      issues: 3,
    },
  ],
  issues: [],
  technical: [
    {
      id: 'seo.h1',
      label: 'Título principal (H1)',
      hint: '',
      scope: 'pages',
      status: 'fail',
      total: 2,
      passed: 1,
      warned: 0,
      failed: 1,
      detail: '1 página precisa de atenção (de 2).',
      pages: [],
    },
  ],
  keywords: [
    {
      id: 'k1',
      term: 'dentista, sp',
      status: 'missing',
      gaps: ['Não aparece em nenhuma página do site.'],
      totalCount: 0,
      pages: [],
    },
    {
      id: 'k2',
      term: 'implante',
      status: 'ok',
      gaps: [],
      totalCount: 4,
      pages: [
        {
          id: 'p1',
          title: 'Início',
          path: '/',
          count: 4,
          density: 1,
          inTitle: true,
          inDescription: false,
          inH1: true,
          inHeadings: true,
          focus: true,
        },
      ],
    },
  ],
  history: [],
}

describe('buildSeoReportCsv', () => {
  const lines = buildSeoReportCsv(detail).split('\r\n')

  it('starts with the BOM and the header', () => {
    expect(lines[0]).toBe('﻿Seção,Item,Detalhe,SEO,AEO,GEO,Situação')
  })

  it('writes summary, pages, checklist and keywords, escaping fields', () => {
    expect(lines).toHaveLength(6)
    expect(lines[1]).toContain('"Clínica ""Sorriso"""')
    expect(lines[1]).toContain(',70,50,40,Publicado')
    expect(lines[2]).toBe('Páginas,Início,/ · 3 ponto(s) a melhorar,80,60,50,')
    expect(lines[3]).toBe(
      'Checklist técnico,Título principal (H1),1 página precisa de atenção (de 2).,,,,Corrigir',
    )
    expect(lines[4]).toBe(
      'Palavras-chave,"dentista, sp",Não aparece em nenhuma página do site.,,,,Ausente',
    )
    expect(lines[5]).toContain('4 ocorrência(s) em 1 página(s).')
    expect(lines[5]).toContain(',Ok')
  })

  it('names the file after the site and the day', () => {
    expect(seoReportFilename('sorriso', detail.generatedAt)).toBe(
      'seo-sorriso-2026-11-19.csv',
    )
  })
})
