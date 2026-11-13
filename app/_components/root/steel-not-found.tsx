'use client'

import { AlertDiamondIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'

export default function Page() {
  return (
    <div className='-mt-8 max-w-82 py-8 px-7 text-left h-screen mx-auto flex flex-col justify-center'>
      <SteelIcon
        icon={AlertDiamondIcon}
        color='#ededed'
        size={40}
        strokeWidth={2}
        className='mb-6'
      />
      <h1 className='text-2xl font-medium leading-8 mb-3 text-[#ededed]'>
        Página não encontrada
      </h1>
      <p className='text-sm font-normal leading-5 mb-5 text-[#ededed]'>
        A página que você procura não existe ou foi movida. Confira o endereço ou volte para o início.
      </p>
      <div className='flex items-center gap-2'>
        <Button size={'sm'} onClick={() => (window.location.href = '/')}>
          Ir para o início
        </Button>
      </div>
    </div>
  )
}
