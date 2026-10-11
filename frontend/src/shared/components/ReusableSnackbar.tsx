import { Alert, Snackbar } from "@mui/material";
import type { Dispatch, SetStateAction } from "react";

interface SnackBar {
    severity: 'success' | 'error';
    msg: string;
}

interface Props {
    snackbar: SnackBar | null;
    setSnackbar: Dispatch<SetStateAction<SnackBar | null>>;
}

const ReusableSnackbar = ({ snackbar, setSnackbar }: Props) => {
    return(
        <Snackbar
            open={!!snackbar}
            autoHideDuration={4000}
            onClose={() => setSnackbar(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
            {snackbar?.severity && (
                <Alert 
                    severity={snackbar?.severity} 
                    onClose={() => setSnackbar(null)} 
                    variant="filled"
                    sx={{ width: '100%' }}
                >
                    {snackbar?.msg}
                </Alert>
            )}
        </Snackbar>
    );
}
export default ReusableSnackbar;