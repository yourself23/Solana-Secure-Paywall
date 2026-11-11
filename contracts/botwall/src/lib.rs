use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer, transfer};

declare_id!("89zS48g49d48fg948g948g948g948g498g948g9");

#[program]
pub mod botwall {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, price: u64) -> Result<()> {
        let paywall = &mut ctx.accounts.paywall;
        paywall.authority = ctx.accounts.authority.key();
        paywall.price = price;
        paywall.treasury = ctx.accounts.treasury.key();
        Ok(())
    }

    pub fn pay(ctx: Context<Pay>) -> Result<()> {
        // Simple bot trap: Require a specific instruction compute budget or account validation
        // In a real scenario, this would involve complex proof-of-work or challenge-response
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.treasury_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        transfer(cpi_ctx, ctx.accounts.paywall.price)?;
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 8 + 32)]
    pub paywall: Account<'info, Paywall>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Pay<'info> {
    #[account(mut)]
    pub paywall: Account<'info, Paywall>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Paywall {
    pub authority: Pubkey,
    pub price: u64,
    pub treasury: Pubkey,
}
