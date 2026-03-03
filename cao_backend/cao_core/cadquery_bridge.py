"""
CadQuery bridges for CAD operations
Wraps CadQuery API for safe and modular operation execution
"""

from typing import Dict, Tuple, Optional, Any
import tempfile
import os
from pathlib import Path
import json

# CadQuery imports
try:
    import cadquery as cq
    CADQUERY_AVAILABLE = True
except ImportError:
    CADQUERY_AVAILABLE = False


class CadQueryBridge:
    """
    Wrapper around CadQuery for safe operation execution
    """

    def __init__(self):
        if not CADQUERY_AVAILABLE:
            raise RuntimeError(
                "CadQuery not available. Please install: pip install CadQuery"
            )
        self.temp_dir = tempfile.gettempdir()
        self.last_solid = None
        self.error_log = []

    def create_sketch_from_profile(
        self,
        sketch_data: Dict[str, Any],
        plane: str = 'XY'
    ) -> Tuple[bool, Optional[cq.Workplane], str]:
        """
        Create a CadQuery workplane from sketch data
        sketch_data: {'points': [...], 'lines': [...], ...}
        Lines format: [{'start': 0, 'end': 1}, ...]
        Points format: [{'x': 0, 'y': 0}, ...]
        Returns: (success, workplane, error_message)
        """
        try:
            # Start with base workplane
            wp = cq.Workplane(plane)

            if 'lines' not in sketch_data or not sketch_data['lines']:
                return False, None, "No lines in sketch"

            lines = sketch_data['lines']
            points_data = sketch_data.get('points', [])
            
            if not lines or not points_data:
                return False, None, "Sketch has no geometry"

            # Create a mapping of point indices to coordinates
            points_map = {}
            for idx, point in enumerate(points_data):
                if isinstance(point, dict) and 'x' in point and 'y' in point:
                    points_map[idx] = (point['x'], point['y'])

            # Extract points from lines (assuming lines form a closed loop)
            extracted_points = []
            
            # Handle list-based lines format (new format from frontend)
            if isinstance(lines, list):
                for line in lines:
                    if isinstance(line, dict) and 'start' in line:
                        start_idx = line['start']
                        if start_idx in points_map:
                            extracted_points.append(points_map[start_idx])
            # Handle dict-based lines format (legacy/fallback)
            else:
                for line_name, line_data in lines.items():
                    start = line_data['start']
                    end = line_data['end']
                    extracted_points.append((start['x'], start['y']))

            # Remove duplicates while preserving order
            if extracted_points:
                unique_points = []
                for p in extracted_points:
                    if not unique_points or p != unique_points[-1]:
                        unique_points.append(p)

                # Check if closed and close if necessary
                if unique_points and unique_points[0] != unique_points[-1]:
                    unique_points.append(unique_points[0])

                # Create polyline (need at least 3 points for a valid face)
                if len(unique_points) >= 3:
                    wp = wp.polyline(unique_points)
                    wp = wp.close()
                    self.last_solid = wp

                    return True, wp, "Sketch profile created successfully"

            return False, None, "Not enough points for valid profile"

        except Exception as e:
            error = f"Error creating sketch profile: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def extrude(
        self,
        workplane: cq.Workplane,
        length: float,
        direction: str = 'Z',
        is_symmetric: bool = False
    ) -> Tuple[bool, Optional[cq.Workplane], str]:
        """
        Extrude a sketch along a direction
        Returns: (success, solid, error_message)
        """
        try:
            if workplane is None:
                return False, None, "No workplane provided"

            # Validate length
            if length <= 0:
                return False, None, "Extrusion length must be positive"

            if length > 1000:  # Sanity check
                return False, None, "Extrusion length is too large (>1000)"

            # Apply extrusion
            if is_symmetric:
                solid = workplane.extrude(length / 2, both=True)
            else:
                solid = workplane.extrude(length)

            self.last_solid = solid
            return True, solid, f"Extrusion of {length}mm successful"

        except Exception as e:
            error = f"Extrusion failed: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def pocket(
        self,
        workplane: cq.Workplane,
        depth: float,
        direction: str = 'Z'
    ) -> Tuple[bool, Optional[cq.Workplane], str]:
        """
        Create a pocket (subtractive feature) in a solid
        Returns: (success, solid, error_message)
        """
        try:
            if workplane is None:
                return False, None, "No workplane provided"

            # Validate depth
            if depth <= 0:
                return False, None, "Pocket depth must be positive"

            if depth > 1000:  # Sanity check
                return False, None, "Pocket depth is too large (>1000)"

            # Apply pocket (negative extrusion)
            solid = workplane.extrude(-depth)

            self.last_solid = solid
            return True, solid, f"Pocket of {depth}mm successful"

        except Exception as e:
            error = f"Pocket operation failed: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def fillet(
        self,
        solid: cq.Workplane,
        radius: float,
        edges: Optional[list] = None
    ) -> Tuple[bool, Optional[cq.Workplane], str]:
        """
        Apply fillet to solid edges
        Returns: (success, solid, error_message)
        """
        try:
            if solid is None:
                return False, None, "No solid provided"

            if radius <= 0:
                return False, None, "Fillet radius must be positive"

            # Apply fillet to all edges if not specified
            if edges is None:
                solid = solid.edges().fillet(radius)
            else:
                # Apply to specific edges
                for edge_selector in edges:
                    solid = solid.edges(edge_selector).fillet(radius)

            self.last_solid = solid
            return True, solid, f"Fillet of {radius}mm applied successfully"

        except Exception as e:
            error = f"Fillet operation failed: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def chamfer(
        self,
        solid: cq.Workplane,
        size: float,
        edges: Optional[list] = None
    ) -> Tuple[bool, Optional[cq.Workplane], str]:
        """
        Apply chamfer to solid edges
        Returns: (success, solid, error_message)
        """
        try:
            if solid is None:
                return False, None, "No solid provided"

            if size <= 0:
                return False, None, "Chamfer size must be positive"

            # Apply chamfer to all edges if not specified
            if edges is None:
                solid = solid.edges().chamfer(size)
            else:
                # Apply to specific edges
                for edge_selector in edges:
                    solid = solid.edges(edge_selector).chamfer(size)

            self.last_solid = solid
            return True, solid, f"Chamfer of {size}mm applied successfully"

        except Exception as e:
            error = f"Chamfer operation failed: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def compute_properties(
        self,
        solid: cq.Workplane
    ) -> Tuple[bool, Dict[str, Any], str]:
        """
        Compute geometry properties (volume, bounding box, etc.)
        Returns: (success, properties, error_message)
        """
        try:
            if solid is None:
                return False, {}, "No solid provided"

            properties = {}

            # Get volume (if it's a solid)
            try:
                val = solid.val()
                if hasattr(val, 'Volume'):
                    # Volume is a property, call it if it's callable
                    volume_value = val.Volume
                    if callable(volume_value):
                        volume_value = volume_value()
                    properties['volume'] = volume_value
                    properties['volume_unit'] = 'mm³'
            except:
                properties['volume'] = None

            # Get bounding box
            try:
                bbox = solid.val().BoundingBox()
                properties['bounding_box'] = {
                    'x_min': bbox.xmin,
                    'x_max': bbox.xmax,
                    'y_min': bbox.ymin,
                    'y_max': bbox.ymax,
                    'z_min': bbox.zmin,
                    'z_max': bbox.zmax,
                    'width': bbox.xmax - bbox.xmin,
                    'height': bbox.ymax - bbox.ymin,
                    'depth': bbox.zmax - bbox.zmin,
                }
            except:
                properties['bounding_box'] = {}

            return True, properties, "Properties computed successfully"

        except Exception as e:
            error = f"Failed to compute properties: {str(e)}"
            self.error_log.append(error)
            return False, {}, error

    def export_step(
        self,
        solid: cq.Workplane,
        filename: Optional[str] = None
    ) -> Tuple[bool, Optional[str], str]:
        """
        Export solid to STEP file
        Returns: (success, file_path, error_message)
        """
        try:
            if solid is None:
                return False, None, "No solid provided"

            if filename is None:
                filename = f"geometry_{id(solid)}.step"

            filepath = os.path.join(self.temp_dir, filename)

            # Export to STEP
            solid.val().exportStep(filepath)

            return True, filepath, f"STEP file exported to {filepath}"

        except Exception as e:
            error = f"STEP export failed: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def export_stl(
        self,
        solid: cq.Workplane,
        filename: Optional[str] = None,
        tolerance: float = 0.01
    ) -> Tuple[bool, Optional[str], str]:
        """
        Export solid to STL file
        Returns: (success, file_path, error_message)
        """
        try:
            if solid is None:
                return False, None, "No solid provided"

            if filename is None:
                filename = f"geometry_{id(solid)}.stl"

            filepath = os.path.join(self.temp_dir, filename)

            # Export to STL
            solid.val().exportStl(filepath, tolerance)

            return True, filepath, f"STL file exported to {filepath}"

        except Exception as e:
            error = f"STL export failed: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def load_step(
        self,
        filepath: str
    ) -> Tuple[bool, Optional[cq.Workplane], str]:
        """
        Load a STEP file and convert to CadQuery workplane
        Returns: (success, workplane, error_message)
        """
        try:
            if not os.path.exists(filepath):
                return False, None, f"STEP file not found: {filepath}"
            
            # Import the STEP file
            wp = cq.importers.importStep(filepath)
            
            if wp is None:
                return False, None, "Failed to import STEP file"
            
            self.last_solid = wp
            return True, wp, f"STEP file loaded successfully from {filepath}"
        
        except Exception as e:
            error = f"Failed to load STEP file: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def pad(
        self,
        workplane: cq.Workplane,
        face_index: int,
        length: float,
        direction: str = 'normal'
    ) -> Tuple[bool, Optional[cq.Workplane], str]:
        """
        Create a pad (additive feature) on an existing geometry
        For 3D solids, we apply a simple translation and union
        Returns: (success, solid, error_message)
        """
        try:
            if workplane is None:
                return False, None, "No workplane provided"
            
            # Validate length
            if length <= 0:
                return False, None, "Pad length must be positive"
            
            if length > 1000:  # Sanity check
                return False, None, "Pad length is too large (>1000)"
            
            # For a 3D solid, we can't extrude a face directly.
            # Instead, we'll use a simple offset operation
            # This moves the solid in the Z direction and creates a union
            try:
                # Simple approach: translate the solid upward and union
                solid_val = workplane.val()
                
                # Create a box to add to the solid at the top
                # Get bounding box
                bbox = solid_val.BoundingBox()
                
                # Create a new box on top
                top_face_z = bbox.zmax
                box_solid = cq.Workplane("XY").box(
                    bbox.xmax - bbox.xmin,
                    bbox.ymax - bbox.ymin,
                    length,
                    centered=False
                ).translate((bbox.xmin, bbox.ymin, top_face_z))
                
                # Union the box with the existing solid
                pad_solid = cq.Workplane().add(workplane).union(box_solid)
            except Exception as inner_e:
                # Fallback: just translate and return
                # This is a simplified version
                return False, None, f"Pad offset failed: {str(inner_e)}"
            
            self.last_solid = pad_solid
            return True, pad_solid, f"Pad of {length}mm created successfully"
        
        except Exception as e:
            error = f"Pad operation failed: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def hole(
        self,
        workplane: cq.Workplane,
        face_index: int,
        radius: float,
        depth: float
    ) -> Tuple[bool, Optional[cq.Workplane], str]:
        """
        Create a hole (circular pocket) on a face
        Returns: (success, solid, error_message)
        """
        try:
            if workplane is None:
                return False, None, "No workplane provided"
            
            # Validate parameters
            if radius <= 0:
                return False, None, "Hole radius must be positive"
            
            if depth <= 0:
                return False, None, "Hole depth must be positive"
            
            if depth > 1000:
                return False, None, "Hole depth is too large (>1000)"
            
            # Create a hole by selecting the top face and cutting
            try:
                # Select the top face and create a hole
                hole_solid = workplane.faces(">Z").workplane().circle(radius).cutBlind(-depth)
            except:
                # Fallback: simpler hole creation if face selection fails
                hole_solid = workplane.circle(radius).cutBlind(-depth)
            
            self.last_solid = hole_solid
            return True, hole_solid, f"Hole of radius {radius}mm and depth {depth}mm created successfully"
        
        except Exception as e:
            error = f"Hole operation failed: {str(e)}"
            self.error_log.append(error)
            return False, None, error

    def reset(self):
        """Reset bridge state"""
        self.last_solid = None
        self.error_log.clear()
