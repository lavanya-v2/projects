import { useState } from "react";
import { Box, Typography, Menu, MenuItem, Avatar } from "@mui/material";
import { KeyboardArrowDown } from "@mui/icons-material";
import { brandColors } from "../theme/tokens";
import type { Account } from "../features/admin/accounts/types";
import { useNavigate } from "react-router-dom";

const { navy, orange } = brandColors;

interface AccountSwitcherMenuProps {
  accounts: Account[];
  activeAccount: Account | null;
  onSelect: (account: Account) => void;
}

/** Dropdown that lets the user switch the active account scope. */
export const AccountSwitcherMenu = ({
  accounts,
  activeAccount,
  onSelect,
}: AccountSwitcherMenuProps) => {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  if (accounts.length === 0) return null;

  const handleSelect = (acct: Account) => {
    onSelect(acct);
    setAnchor(null);
    navigate("/dashboard");
  };

  return (
    <>
      <Box
        data-testid="account-switcher-trigger"
        data-active-account={activeAccount?.name ?? ""}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1.25,
          py: 0.5,
          bgcolor: "#f4f6f9",
          border: "1px solid #e1e8f0",
          borderRadius: 1.5,
          cursor: "pointer",
          "&:hover": { bgcolor: "#eef2f8", borderColor: "#c7d7ee" },
          transition: "all 0.12s",
        }}
      >
        <Typography
          sx={{
            fontFamily: "Inter, sans-serif",
            fontSize: 12,
            fontWeight: 500,
            color: navy,
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {activeAccount?.name ?? "All Accounts"}
        </Typography>
        <KeyboardArrowDown sx={{ fontSize: 14, color: "#9ca3af" }} />
      </Box>

      <Menu
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            width: 240,
            mt: 0.5,
            borderRadius: 2,
            boxShadow: "0 8px 32px rgba(0,46,91,0.12)",
            border: "1px solid #e1e8f0",
          },
        }}
      >
        <Typography
          sx={{
            px: 2,
            pt: 1.5,
            pb: 0.5,
            fontFamily: "Inter, sans-serif",
            fontSize: 10,
            fontWeight: 700,
            color: "#9ca3af",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Switch Account
        </Typography>
        {accounts.map((acct) => (
          <MenuItem
            key={acct.id}
            data-testid={`account-switcher-option-${acct.id}`}
            data-account-name={acct.name}
            onClick={() => handleSelect(acct)}
            sx={{ gap: 1.25, py: 1, borderRadius: 1, mx: 0.5 }}
          >
            <Avatar
              sx={{
                width: 28,
                height: 28,
                bgcolor: navy,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {acct.name?.[0]}
            </Avatar>
            <Box>
              <Typography
                sx={{
                  fontFamily: "Inter, sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  color: navy,
                }}
              >
                {acct.name}
              </Typography>
              {activeAccount?.id === acct.id && (
                <Typography
                  sx={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: 10,
                    color: orange,
                  }}
                >
                  Active
                </Typography>
              )}
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
