// src/styles/Home.ts
import { styled } from '@mui/system';

export const HomeContainer = styled('div')({
    background: 'var(--brand-pink, #EC008C)',
    height: '100vh',
    marginTop: '0px !important'
});

export const HomeBalance = styled('div')({
    color: 'var(--text-text-inverted, #FFF)',
    fontFamily: 'Segoe UI',
    fontSize: '48px',
    fontStyle: 'normal',
    fontWeight: '700',
    lineHeight: '43.7px',
    letterSpacing: '0.76px',
});

export const HomeHello = styled('div')({
    color: 'var(--text-text-inverted, #FFF)',
    fontFamily: 'Segoe UI',
    fontSize: '28px',
    fontStyle: 'normal',
    fontWeight: '400',
    lineHeight: 'normal',
    letterSpacing: '0.11px',
    paddingTop: '40px'
});

export const HomeAllowance = styled('div')({
    color: 'var(--text-text-inverted, #FFF)',
    fontFamily: 'Segoe UI',
    fontSize: '16px',
    fontStyle: 'normal',
    fontWeight: '400',
    lineHeight: 'normal',
    //textDecorationLine: 'underline',
});

export const HomePiggy = styled('div')({
    background: 'var(--brand-pink, #EC008C)',
    height: '100vh',
    marginTop: '0px !important'
});
