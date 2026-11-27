import { useLocation } from 'react-router-dom';
import { Home } from 'lucide-react';
import { api } from '@/api/client';
import { useQuery } from '@tanstack/react-query';

export default function PageNotFound({}) {
    const location = useLocation();
    const pageName = location.pathname.substring(1);

    const { data: authData, isFetched } = useQuery({
        queryKey: ['user'],
        queryFn: async () => {
            try {
                const user = await api.auth.me();
                return { user, isAuthenticated: true };
            } catch (error) {
                return { user: null, isAuthenticated: false };
            }
        }
    });

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
            <div className="max-w-md w-full">
                <div className="text-center space-y-6">
                    <div className="space-y-4">
                        <p className="vr-display text-8xl text-steel">404</p>
                        <div className="h-0.5 w-16 bg-border mx-auto"></div>
                    </div>

                    <div className="space-y-3">
                        <h2 className="text-2xl text-foreground">Page not found</h2>
                        <p className="text-muted-foreground leading-relaxed">
                            There is no page at <span className="font-medium text-foreground">"{pageName}"</span>.
                        </p>
                    </div>

                    {isFetched && authData.isAuthenticated && authData.user?.role === 'admin' && (
                        <div className="mt-8 p-4 bg-card rounded-2xl border border-border text-left space-y-1">
                            <p className="vr-label">Admin note</p>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                This page has not been built yet.
                            </p>
                        </div>
                    )}

                    <div className="pt-6">
                        <button
                            onClick={() => window.location.href = '/'}
                            className="inline-flex min-h-12 items-center gap-2 rounded-full border-[1.5px] border-foreground px-6 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/10"
                        >
                            <Home className="h-4 w-4" strokeWidth={1.75} />
                            Go home
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
