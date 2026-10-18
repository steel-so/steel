import { Muted } from "@/components/typography/text/muted";
import Image from "next/image";
import Link from "next/link";

interface PathProps {
  /** Caminho absoluto (com `/` inicial), incluindo `?redirect=` quando houver. */
  path: string;
  pathname: string;
  /** Texto antes do link (ex.: "Já tem conta?" na tela de cadastro). */
  prompt?: string;
}

export function HeaderLogin({ path, pathname, prompt = 'Não tem conta?' }: PathProps) {
  return (
    <div className='w-full flex items-center justify-between'>
      <Link href='/'>
        <Image src='/brand/logo.svg' alt='steel-logo' width={71} height={20} style={{ height: 'auto' }} className='invert dark:invert-0' priority />
      </Link>
      <div className='text-center text-sm'>
        <Muted>
          {prompt}{' '}
          <Link href={path} className='text-primary hover:underline'>
            {pathname}
          </Link>
        </Muted>
      </div>
    </div>
  )
}
