"use client";

interface VegNonVegTagProps {
    type?: string | null;
    className?: string;
}

export default function VegNonVegTag({ type, className }: VegNonVegTagProps) {
    const isVeg = (type ?? "").toLowerCase() === "veg" || (type ?? "").toLowerCase() === "vegetarian";

    return (
        <div
            className={className ?? "absolute top-2 z-20 right-0 w-10 h-10 flex items-center justify-center"}
            title={isVeg ? "Vegetarian" : "Non-Vegetarian"}
            aria-label={isVeg ? "Vegetarian" : "Non-Vegetarian"}
        >
            {isVeg ? (
                <span className="block">
                    <span
                        style={{
                            border: "2px solid #16A34A",
                            borderRadius: 4,
                            background: "#fff",
                            width: 15,
                            height: 15,
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "center",
                            alignItems: "center",
                        }}
                    >
                        <span
                            style={{
                                background: "#16A34A",
                                borderRadius: "50%",
                                width: 8,
                                height: 8,
                            }}
                        />
                    </span>
                </span>
            ) : (
                <span className="block">
                    <span
                        style={{
                            border: "2px solid #DC2626",
                            borderRadius: 4,
                            background: "#fff",
                            width: 15,
                            height: 15,
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "center",
                            alignItems: "center",
                        }}
                    >
                        <span
                            style={{
                                background: "#DC2626",
                                borderRadius: "50%",
                                width: 8,
                                height: 8,
                            }}
                        />
                    </span>
                </span>
            )}
        </div>
    );
}